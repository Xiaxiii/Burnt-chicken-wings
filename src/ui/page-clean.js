// 「清理」页：预设 / 扩展数据 / 角色卡 / 世界书。
// 每栏：汇总 → 列表（勾选）→ 底栏（已选 n 个与操作）。删除前提供下载备份；预设可归档（移出预设文件夹，可恢复）
const CLEAN_KINDS = [["preset", "预设"], ["ext", "扩展数据"], ["char", "角色卡"], ["world", "世界书"]];
const cleanStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
function mountCleanPage(page) {
  page.innerHTML = String(html`<header class="cw-pagehead"><div class="cw-col">${segHtml(CLEAN_KINDS, "preset", { attr: "data-kind", label: "清理什么" })}</div></header>
    <div class="cw-body"><div class="cw-col cw-clean" data-r="body"></div></div>
    <div class="cw-bar cw-cleanbar" hidden><div class="cw-col"><div class="cw-bar-info"><b></b><small></small></div><div class="cw-bar-acts"></div></div></div>`);
  const body = page.querySelector('[data-r="body"]');
  const bar = page.querySelector(".cw-cleanbar");
  let kind = "preset";
  let busy = false;
  // 每栏各自的勾选
  const sel = { preset: new Set(), ext: new Set(), char: new Set(), world: new Set() };
  const S = () => sel[kind];
  // ---------- 共用 ----------
  const row = ({ key, name, tags = "", size = null, max = 1, locked = false, sizeText = null }) => html`<label class="cw-crow${S().has(key) ? " is-sel" : ""}${locked ? " is-locked" : ""}">
      <input type="checkbox" class="cw-tickbox" data-act="pick" data-k="${key}"${S().has(key) ? raw(" checked") : ""}${locked ? raw(" disabled") : ""}>
      <span class="cw-crow-main"><b>${name}</b>${tags ? html`<span class="cw-crow-tags">${tags}</span>` : ""}</span>
      ${size != null || sizeText ? html`<span class="cw-crow-size">${size != null ? sizeBar(size, max) : ""}<em>${sizeText ?? fmtSize(size)}</em></span>` : ""}</label>`;
  const setBar = (n, info, small, acts) => {
    bar.hidden = !n;
    if (!n) return;
    bar.querySelector(".cw-bar-info b").textContent = info;
    bar.querySelector(".cw-bar-info small").textContent = small || "";
    bar.querySelector(".cw-bar-acts").innerHTML = String(acts);
  };
  const setBusy = (on, text) => {
    busy = on;
    bar.querySelectorAll("button").forEach((b) => { b.disabled = on; });
    if (text) bar.querySelector(".cw-bar-info small").textContent = text;
  };
  const sum = (main, tip, extra = "") => html`<div class="cw-sum"><div class="cw-sum-h"><p class="cw-sum-main">${main}</p><span class="cw-gap"></span>${tipBtn()}</div>${tipNote(tip)}${extra}</div>`;

  // ========== 预设 ==========
  const P = { filter: null, sort: "size", rows: [], pairOpen: new Set(), pairMore: false, scanned: false };
  const estimate = (bytes) => { try { return wireEstimate(bytes); } catch { return null; } };
  async function scanPresetRows() {
    const names = listPresets();
    const { presets } = pm().getPresetList();
    const cur = currentPresetName();
    const list = [];
    await nextPaint();
    let slice = performance.now();
    for (const n of names) {
      const obj = n === cur ? null : presets[presetIndex(n)];
      // 1 分钟内算过的预设直接用结果
      const known = scanCached(obj);
      if (known) { list.push({ name: n, data: obj, full: known.full, size: known.size, prints: known.prints }); continue; }
      let text;
      try { text = n === cur ? presetText(n) : JSON.stringify(obj ?? null); } catch { continue; }
      const data = n === cur ? JSON.parse(text) : obj;
      const s = { full: hashStr(text), size: new Blob([text]).size, prints: promptPrints(data) };
      if (obj && typeof obj === "object") scanCache.set(obj, { ...s, at: Date.now() });
      list.push({ name: n, data, ...s });
      // 每 30ms 让出一次，大预设多时界面不卡
      if (performance.now() - slice > 30) { await new Promise((r) => setTimeout(r, 0)); slice = performance.now(); }
    }
    P.rows = scanPresets(list, { current: cur, inUse: presetUsers(), lastUse: settings().presetUse || {} });
    for (const n of [...sel.preset]) if (!P.rows.some((r) => r.name === n && !r.current)) sel.preset.delete(n);
    if (!P.filter) P.filter = P.rows.some((r) => r.suggest) ? "suggest" : "all";
    P.scanned = true;
  }
  const presetView = () => {
    const rows = P.filter === "suggest" ? P.rows.filter((r) => r.suggest) : P.rows;
    const by = { size: (a, b) => b.size - a.size, name: (a, b) => a.name.localeCompare(b.name, "zh"), used: (a, b) => (a.lastUse || 0) - (b.lastUse || 0) || b.size - a.size }[P.sort];
    return [...rows].sort(by);
  };
  const TAG_TONE = { same: "warn", old: "warn", series: "line", near: "line", use: "accent" };
  const tagPill = (t) => pill(t.t, TAG_TONE[t.k] || "muted", t.t);
  function drawPresets() {
    const all = P.rows;
    const total = all.reduce((n, r) => n + r.size, 0);
    const sugg = all.filter((r) => r.suggest);
    const suggSize = sugg.reduce((n, r) => n + r.size, 0);
    const arch = archiveList();
    const archSize = arch.reduce((n, a) => n + (a.size || 0), 0);
    const est = estimate(total);
    let others = { n: 0, size: 0 };
    try { const l = allPresetSizes().filter((x) => x.api !== "openai"); others = { n: l.length, size: l.reduce((n, x) => n + x.size, 0) }; } catch {}
    const max = all.length ? Math.max(...all.map((r) => r.size)) : 1;
    const since = settings().presetUseSince;
    const presetRow = (r, role = "") => row({
      key: r.name, name: r.name, size: r.size, max, locked: r.current,
      tags: html`${role}${r.current ? pill("当前使用", "accent") : ""}${role ? "" : r.tags.map(tagPill)}${r.inUse.map((w) => pill(`${w}在用`, "accent"))}${r.lastUse ? pill(relDay(r.lastUse)) : since && Date.now() - since > 7 * 864e5 ? pill("开始记录后未用过") : ""}`
    });
    const list = presetView();
    // 「可清理」按相近的两份（或一份与它的几个旧版）折叠成组，两边都列出
    const byName = new Map(all.map((r) => [r.name, r]));
    const groups = [];
    if (P.filter === "suggest") {
      const at = new Map();
      for (const r of list) {
        const ref = r.tags[0]?.ref;
        const keep = byName.get(ref);
        if (!keep) { groups.push({ keep: null, items: [r] }); continue; }
        if (!at.has(ref)) { at.set(ref, { keep, items: [] }); groups.push(at.get(ref)); }
        at.get(ref).items.push(r);
      }
    }
    const keepWhy = (k, o) => k.current ? "当前使用" : k.inUse.length ? `${k.inUse[0]}在用` : (k.lastUse || 0) > (o.lastUse || 0) ? "最近用过" : o.tags[0]?.k === "old" ? "版本更新" : "";
    const short = (t) => t.replace(/^与「[^」]*」\s*/, "");
    const PAIR_MAX = 8;
    const pairHtml = (g) => {
      const first = g.items[0], key = g.keep?.name || first.name;
      const picked = [g.keep, ...g.items].filter((r) => r && sel.preset.has(r.name)).length;
      const why = g.keep ? keepWhy(g.keep, first) : "";
      const head = g.keep ? g.items.length === 1 ? html`<b>${first.name}</b><span class="cw-dim"> ↔ </span><b>${g.keep.name}</b>` : html`<b>${g.keep.name}</b><span class="cw-dim"> 与 ${g.items.length} 份相近</span>` : html`<b>${first.name}</b>`;
      return html`<details class="cw-cpair" data-pair="${key}"${P.pairOpen.has(key) ? raw(" open") : ""}>
        <summary>${iconHtml("chev")}<span class="cw-cpair-t">${head}</span><span class="cw-crow-tags">${g.items.length === 1 ? tagPill({ k: first.tags[0].k, t: short(first.tags[0].t) }) : ""}${picked ? pill(`已选 ${picked}`, "warn") : ""}</span></summary>
        <p class="cw-hint">勾选要清理的一份，两份均可选。${why ? `建议保留「${g.keep.name}」（${why}）。` : ""}</p>
        <div class="cw-clist">${g.keep ? presetRow(g.keep, pill("建议保留", "ok")) : ""}${g.items.map((r) => presetRow(r, tagPill({ k: r.tags[0].k, t: short(r.tags[0].t) || "可清理" })))}</div></details>`;
    };
    const tip = `<p>酒馆每次打开都读取全部聊天补全预设${est ? `，约占设置下载 ${fmtSize(est.wire)}（估计）` : ""}。</p>
      ${others.n ? `<p>其他类型预设 ${others.n} 个（${fmtSize(others.size)}）同样随设置读取，本页不处理。</p>` : ""}
      ${arch.length ? `<p>已归档 ${arch.length} 个（${fmtSize(archSize)}），打开时不再读取。</p>` : ""}
      <ul class="cw-legend"><li><span class="cw-pill cw-pill-warn">完全相同</span>与另一个预设一字不差，保留一个即可。</li><li><span class="cw-pill cw-pill-warn">有新版</span>名称相同、版本号更低。</li><li><span class="cw-pill cw-pill-line">同系列</span>名称只差「_json」「(1)」「副本」等后缀。</li><li><span class="cw-pill cw-pill-line">条目相同</span>与另一个预设的大部分条目相同。</li><li><span class="cw-pill cw-pill-accent">在用</span>被方案或连接配置使用。</li></ul>
      <p>归档：移出预设文件夹、存入服务器，打开酒馆时不再读取，可随时恢复。标签仅作提示；正在使用的预设不能勾选。</p>`;
    const stack = html`<div class="cw-stack" aria-hidden="true">${[...all].sort((a, b) => (b.suggest - a.suggest) || (b.size - a.size)).map((r) => html`<i class="${sel.preset.has(r.name) ? "is-sel" : r.suggest ? "is-sug" : ""}" style="flex-grow:${r.size}" title="${r.name} ${fmtSize(r.size)}"></i>`)}</div>
      <p class="cw-stack-key"><span><i class="is-sug"></i>可考虑清理</span><span><i></i>其余</span><span><i class="is-sel"></i>已勾选</span></p>`;
    const visible = list.filter((r) => !r.current);
    const allOn = visible.length && visible.every((r) => sel.preset.has(r.name));
    body.innerHTML = String(html`
      ${sum(html`<b>${all.length}</b> 个预设 · <b>${fmtSize(total)}</b>${arch.length ? ` · 已归档 ${arch.length}` : ""}${sugg.length ? html` · <span class="cw-warn-text">可清理 ${sugg.length}（${fmtSize(suggSize)}）</span>` : ""}`, tip, stack)}
      <div class="cw-filterrow">${segHtml([["suggest", `可清理 ${sugg.length}`], ["all", `全部 ${all.length}`], ["arch", `已归档 ${arch.length}`]], P.filter, { attr: "data-filter", size: "sm" })}<span class="cw-gap"></span>
        ${P.filter !== "arch" ? btn({ size: "大小", used: "最近使用", name: "名称" }[P.sort], { act: "sort", size: "sm", kind: "ghost", icon: "sort", title: "排序方式" }) : ""}</div>
      ${P.filter === "arch"
        ? arch.length ? html`<div class="cw-clist">${arch.map((a, i) => html`<div class="cw-crow is-arch"><span class="cw-crow-main"><b>${a.name}</b><span class="cw-crow-tags">${pill(`${dateStr(a.at)} 归档`)}</span></span><span class="cw-crow-size"><em>${fmtSize(a.size || 0)}</em></span>
            <span class="cw-crow-acts">${btn("恢复", { act: "restore", size: "sm", attrs: `data-i="${i}"` })}${ibtn("fileOut", "下载", { act: "adl", attrs: `data-i="${i}"` })}${ibtn("trash", "删除归档", { act: "adel", attrs: `data-i="${i}"`, cls: "cw-ibtn-danger" })}</span></div>`)}</div>` : empty("还没有归档的预设。")
        : list.length ? html`${visible.length ? html`<div class="cw-listhead"><button type="button" class="cw-link" data-act="all">${allOn ? "取消全选" : P.filter === "suggest" ? "全选可清理" : "全选本页"}</button></div>` : ""}
            ${P.filter === "suggest" ? html`<div class="cw-pairs">${groups.slice(0, P.pairMore ? groups.length : PAIR_MAX).map(pairHtml)}${groups.length > PAIR_MAX && !P.pairMore ? html`<button type="button" class="cw-link" data-act="pairmore">再显示 ${groups.length - PAIR_MAX} 组</button>` : ""}</div>` : html`<div class="cw-clist">${list.map((r) => presetRow(r))}</div>`}`
          : empty("没有可清理的预设。")}`);
    const pick = P.rows.filter((r) => sel.preset.has(r.name));
    const size = pick.reduce((n, r) => n + r.size, 0);
    const e2 = estimate(size);
    setBar(P.filter === "arch" ? 0 : pick.length, `已选 ${pick.length} 个 · ${fmtSize(size)}`, e2?.wire ? `设置下载约少 ${fmtSize(e2.wire)}（估计）` : "",
      html`${btn("取消", { act: "none" })}${btn("下载", { act: "dl", icon: "fileOut" })}${btn("删除", { act: "del", kind: "danger" })}${btn("归档", { act: "arch", kind: "primary", title: "移出预设文件夹，打开酒馆时不再读取，可随时恢复" })}`);
  }
  const zipOf = (names) => makeZip(names.map((n) => ({ name: `${n}.json`, data: JSON.stringify(JSON.parse(presetText(n)), null, 4) })));
  const usersOf = (names) => names.flatMap((n) => (presetUsers()[n] || []).map((w) => `${w}（${n}）`));
  async function archivePresets(names) {
    const users = usersOf(names);
    const size = P.rows.filter((r) => names.includes(r.name)).reduce((n, r) => n + r.size, 0);
    const ok = await dialog({
      size: "sm",
      title: `归档 ${names.length} 个预设`,
      body: html`<p class="cw-p">共 ${fmtSize(size)}。归档后这些预设不再出现在酒馆的预设列表中，打开酒馆时也不再下载；在「清理 → 预设 → 已归档」中可随时恢复。</p>
        ${users.length ? html`<p class="cw-hint">${users.slice(0, 4).join("、")}${users.length > 4 ? ` 等 ${users.length} 处` : ""}使用了这些预设。${users.some((w) => w.startsWith("方案")) ? "套用相应方案时会自动从归档恢复。" : ""}${users.some((w) => w.startsWith("连接配置")) ? "酒馆的连接配置不会自动恢复，使用前需先在这里恢复。" : ""}</p>` : ""}
        <label class="cw-check"><input type="checkbox" data-zip checked><span>同时下载一份到本地（zip）</span></label>`,
      actions: [{ label: "取消", value: null }, { label: "归档", kind: "primary", value: (w) => ({ zip: w.querySelector("[data-zip]").checked }) }]
    });
    if (!ok) return;
    if (ok.zip) downloadBlob(zipOf(names), `preset-archive-${cleanStamp()}.zip`);
    const done = [], fail = [];
    for (const [i, n] of names.entries()) {
      setBusy(true, `正在归档 ${i + 1}/${names.length}：${n}`);
      let path = null;
      try {
        // 没存完的修改先存上；正在发出的保存也等它结束
        await saveDraft(n, "归档前保存");
        const text = presetText(n);
        const gz = await gzipText(text);
        // 文件名带上预设名：设置文件里的归档清单丢了也认得出
        const safe = String(n).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
        const fname = `pa-preset-${safe}-${hashStr(n + text).slice(0, 8)}-${Date.now().toString(36)}.json${gz ? ".gz" : ""}`;
        path = await userFilePut(fname, gz || new Blob([text], { type: "application/json" }));
        // 读回来逐字核对，核对不上（包括读不到）就不删原预设
        let back = null;
        try { back = await userFileGetText(path, !!gz); } catch (e) { throw new Error(`上传后无法读回核对（${e.message}）`); }
        if (back !== text) throw new Error("上传后读回的内容和原预设不一致");
        await quiesceDraft(n);
        if (presetText(n) !== text) throw new Error("归档过程中预设又被修改了，请重新归档");
        await deletePresetFile(n);
        const list = archiveList();
        const old = list.filter((x) => x.name === n);
        list.push({ id: Date.now().toString(36) + i, name: n, path, gz: !!gz, size: new Blob([text]).size, at: Date.now() });
        for (const o of old) { list.splice(list.indexOf(o), 1); userFileDel(o.path).catch(() => {}); }
        saveSettings();
        dropDraft(n);
        sel.preset.delete(n);
        done.push(n);
      } catch (e) {
        console.warn("[焦香鸡翅] 归档失败", n, e);
        if (path && listPresets().includes(n)) userFileDel(path).catch(() => {});
        fail.push(`${n}：${e.message}`);
      }
    }
    setBusy(false);
    if (done.length) toast(`已归档 ${done.length} 个预设`, "success");
    if (fail.length) toast(`${fail.length} 个归档失败（预设保持原样）：${fail.slice(0, 2).join("；")}`, "error");
    emitChange(currentPresetName());
    renderPresets();
  }
  async function deletePresets(names) {
    const users = usersOf(names);
    const go = await confirmDeleteOfferBackup(`删除 ${names.length} 个预设`, String(html`<p class="cw-p">将从服务器上删除这些预设，<b>删除后无法在酒馆中恢复</b>，需要的话先下载备份。以后可能还会用到的，建议改用「归档」。</p>
        ${users.length ? html`<p class="cw-p cw-warn-text">${users.slice(0, 4).join("、")}${users.length > 4 ? ` 等 ${users.length} 处` : ""}正在使用这些预设，删除后它们将无法套用。</p>` : ""}`), async () => {
      const fname = `preset-backup-${cleanStamp()}.zip`;
      downloadBlob(zipOf(names), fname);
      return `已让浏览器下载「${esc(fname)}」，可在下载记录里确认。`;
    });
    if (!go) return;
    let n = 0;
    const fail = [];
    for (const [i, name] of names.entries()) {
      setBusy(true, `正在删除 ${i + 1}/${names.length}：${name}`);
      try {
        await quiesceDraft(name);
        await deletePresetFile(name);
        sel.preset.delete(name);
        n++;
      } catch (e) {
        fail.push(`${name}：${e.message}`);
      }
    }
    setBusy(false);
    if (n) toast(`已删除 ${n} 个预设`, "success");
    if (fail.length) toast(`${fail.length} 个删除失败：${fail.slice(0, 2).join("；")}`, "error");
    emitChange(currentPresetName());
    renderPresets();
  }
  async function renderPresets() {
    if (busy || kind !== "preset") return;
    if (!P.scanned) body.innerHTML = String(html`<p class="cw-hint cw-pad">正在分析预设…</p>`);
    try { await scanPresetRows(); } catch (e) { body.innerHTML = String(html`<p class="cw-warn-text">分析出错：${e.message}</p>`); return; }
    if (kind === "preset") drawPresets();
  }
  async function presetClick(a, b) {
    if (a === "sort") {
      const v = await pickName({ title: "排序", current: P.sort, search: false, items: [{ value: "size", label: "按大小" }, { value: "used", label: "按最近使用" }, { value: "name", label: "按名称" }] });
      if (v && v !== P.sort) { P.sort = v; drawPresets(); }
      return;
    }
    if (a === "pairmore") { P.pairMore = true; return drawPresets(); }
    const names = P.rows.filter((r) => sel.preset.has(r.name)).map((r) => r.name);
    if (a === "all") {
      const vis = presetView().filter((r) => !r.current);
      const allOn = vis.every((r) => sel.preset.has(r.name));
      for (const r of vis) allOn ? sel.preset.delete(r.name) : sel.preset.add(r.name);
      return drawPresets();
    }
    if (a === "none") { sel.preset.clear(); return drawPresets(); }
    if (a === "dl") return downloadBlob(zipOf(names), `presets-${cleanStamp()}.zip`);
    if (a === "arch") return archivePresets(names);
    if (a === "del") return deletePresets(names);
    const arc = archiveList()[Number(b.dataset.i)];
    if (!arc) return;
    b.disabled = true;
    try {
      if (a === "restore") {
        if (await restoreArchived(arc)) toast(`已恢复「${arc.name}」`, "success");
        emitChange(currentPresetName());
        await renderPresets();
      } else if (a === "adl") {
        const text = await userFileGetText(arc.path, arc.gz);
        downloadBlob(new Blob([JSON.stringify(JSON.parse(text), null, 4)], { type: "application/json" }), `${arc.name}.json`);
      } else if (a === "adel") {
        if (!await confirmBox("删除归档", `将从服务器上删除「${arc.name}」的归档文件，删除后无法恢复。`, "删除", true)) return;
        await userFileDel(arc.path);
        const list = archiveList();
        list.splice(list.indexOf(arc), 1);
        saveSettings();
        drawPresets();
      }
    } catch (err) {
      toast(err.message, "error");
    } finally {
      b.disabled = false;
    }
  }

  // ========== 扩展数据 ==========
  const X = { exts: null, scan: null, err: "", loading: false, progress: "" };
  function extRows() {
    const es = ctx().extensionSettings || {};
    return Object.keys(es).map((k) => {
      const size = jsonSize(es[k]);
      const owner = guessOwner(k, X.exts);
      const users = X.scan?.used[k];
      const nm = (x) => x.manifest?.display_name || x.base;
      let state, label;
      if (CORE_EXT_KEYS.has(k)) [state, label] = ["core", k === "presetAtelier" ? "本扩展" : "酒馆设置"];
      else if (owner?.builtin) [state, label] = ["used", owner.builtin === "本扩展" ? "本扩展" : `酒馆内置：${owner.builtin}`];
      else if (owner?.known && (owner.running || owner.ext)) [state, label] = ["used", `${owner.known}${owner.running ? "在用" : owner.ext?.enabled === false ? "（已停用）" : "（已安装）"}`];
      else if (owner?.known && X.exts) [state, label] = ["maybe", `${owner.known}的数据，没有找到${owner.known}，可能已卸载`];
      else if (users?.length) [state, label] = ["used", `检测：${users.map(nm).slice(0, 2).join("、")}${users.some((x) => !x.enabled) ? "（已停用）" : ""}在用`];
      else if (X.scan && owner?.ext) [state, label] = ["maybe", `检测：未找到使用者，但名称像「${nm(owner.ext)}」，请确认`];
      else if (X.scan && X.scan.partial.length) [state, label] = ["maybe", `检测：未找到使用者，但「${X.scan.partial.map(nm).slice(0, 2).join("、")}」没有查完，请确认`];
      // 没找到使用者不等于可以安全删除，只标为「疑似残留」，删前由用户核对
      else if (X.scan) [state, label] = ["orphan", "检测：已安装扩展的代码里没找到它，疑似卸载残留，删除前请核对"];
      else if (owner?.ext) [state, label] = ["used", `推测属于：${nm(owner.ext)}${owner.ext.enabled ? "" : "（已停用）"}`];
      else [state, label] = ["maybe", "可能已卸载"];
      return { k, size, state, label };
    }).sort((a, b) => b.size - a.size);
  }
  function drawExt() {
    const list = extRows();
    const total = list.reduce((n, r) => n + r.size, 0);
    const max = list[0]?.size || 1;
    const pick = list.filter((r) => sel.ext.has(r.k));
    const orphans = list.filter((r) => r.state === "orphan");
    const tone = { orphan: "warn", maybe: "line", used: "accent", core: "muted" };
    body.innerHTML = String(html`
      ${sum(html`扩展数据 <b>${fmtSize(total)}</b> · ${list.length} 项${orphans.length ? html` · <span class="cw-warn-text">疑似残留 ${orphans.length}</span>` : ""}`,
        "<p>设置文件每次打开酒馆都要下载，每次保存都要上传，删掉已卸载扩展的残留数据能减少这部分。</p><p>「可能已卸载」只是按名称推测。「实际检测」会下载已安装扩展的脚本，查找谁在使用这些数据；扩展用拼接出来的名字读数据时查不出来，结果只能作参考。</p><p>正在使用的数据不能勾选。删除时可先下载备份（JSON），需要时交给对应扩展重新导入。</p>",
        html`<div class="cw-card-acts">${btn(busy ? "检测中…" : X.scan ? "重新检测" : "实际检测", { act: "scan", size: "sm", icon: "search", disabled: busy })}${orphans.length ? btn(`勾选 ${orphans.length} 项疑似残留`, { act: "pickorphans", size: "sm", kind: "ghost" }) : ""}<small class="cw-dim">${X.progress}</small></div>
          ${X.scan ? html`<p class="cw-hint">${orphans.length ? "勾选后请逐项确认名称再删除。" : "没有找到疑似残留的数据。"}${X.scan.partial.length ? `「${X.scan.partial.map((x) => x.manifest?.display_name || x.base).join("、")}」没有查完，标「请确认」的需自行判断。` : ""}</p>` : ""}`)}
      ${X.err ? html`<p class="cw-warn-text">${X.err}</p>` : ""}
      <div class="cw-clist">${list.map((r) => row({ key: r.k, name: r.k, size: r.size, max, locked: r.state === "core" || r.state === "used", tags: pill(r.label, tone[r.state]) }))}</div>`);
    setBar(pick.length, `已选 ${pick.length} 项 · ${fmtSize(pick.reduce((n, r) => n + r.size, 0))}`, "", html`${btn("取消", { act: "none" })}${btn("删除", { act: "del", kind: "danger" })}`);
  }
  async function extClick(a) {
    if (a === "scan") {
      busy = true;
      X.progress = "";
      drawExt();
      try {
        X.exts ||= await discoverExtensions();
        const keys = Object.keys(ctx().extensionSettings || {}).filter((k) => !CORE_EXT_KEYS.has(k) && !BUILTIN_EXT_KEYS[k]);
        X.scan = await scanExtensionCode(X.exts, keys, (i, n, nm) => {
          X.progress = `正在检测 ${i}/${n}：${nm}`;
          const p = body.querySelector(".cw-sum .cw-card-acts small");
          if (p) p.textContent = X.progress;
        });
        for (const k of [...sel.ext]) if (X.scan.used[k]?.length) sel.ext.delete(k);
      } catch (er) {
        X.err = er.message;
      }
      busy = false;
      X.progress = "";
      return drawExt();
    }
    if (a === "pickorphans") { for (const r of extRows()) if (r.state === "orphan") sel.ext.add(r.k); return drawExt(); }
    if (a === "none") { sel.ext.clear(); return drawExt(); }
    if (a === "del") {
      const keys = [...sel.ext];
      if (!keys.length) return;
      const es = ctx().extensionSettings;
      const go = await confirmDeleteOfferBackup("删除扩展数据", String(html`<p class="cw-p">将从设置文件中删除 ${keys.length} 项数据：${keys.slice(0, 5).join("、")}${keys.length > 5 ? " 等" : ""}。删除后不能恢复，需要的话先下载备份（JSON），可交给对应扩展重新导入。对应的扩展其实还在使用时，它会恢复成默认设置。</p>`), async () => {
        const fname = `extension-data-backup-${cleanStamp()}.json`;
        downloadBlob(new Blob([JSON.stringify(Object.fromEntries(keys.map((k) => [k, es[k]])), null, 2)], { type: "application/json" }), fname);
        return `已让浏览器下载「${esc(fname)}」，可在下载记录里确认。`;
      });
      if (!go) return;
      for (const k of keys) { delete es[k]; sel.ext.delete(k); }
      ctx().saveSettingsDebounced();
      toast(`已删除 ${keys.length} 项扩展数据`, "success");
      return drawExt();
    }
  }

  // ========== 角色卡 ==========
  const C = { loadingFull: false };
  const CHAR_FIELDS = [["description", "描述"], ["personality", "性格"], ["scenario", "场景"], ["first_mes", "开场白"], ["mes_example", "示例对话"], ["alternate_greetings", "备选开场白"], ["system_prompt", "系统提示"], ["post_history_instructions", "历史后指令"], ["creator_notes", "作者备注"], ["character_book", "角色书"], ["tags", "标签"], ["extensions", "扩展数据"]];
  const dupKey = (g) => `${String(g[0].name || "").trim().toLowerCase()}\n${g.map((ch) => ch.avatar).sort().join("\n")}`;
  function drawChars() {
    const c = ctx();
    const chars = c.characters || [];
    const cur = chars[Number(c.characterId)]?.avatar;
    const groups = new Map();
    for (const ch of chars) {
      const k = String(ch?.name || "").trim().toLowerCase();
      if (!k) continue;
      (groups.get(k) || groups.set(k, []).get(k)).push(ch);
    }
    const allDups = [...groups.values()].filter((g) => g.length > 1);
    const dups = allDups.filter((g) => !ignoredCharDups.has(dupKey(g)));
    const nIgnored = allDups.length - dups.length;
    for (const g of allDups) if (ignoredCharDups.has(dupKey(g))) for (const ch of g) sel.char.delete(ch.avatar);
    // 按需加载的角色卡没有完整数据，用向服务器读到的
    const fullOf = (ch) => {
      if (!ch.shallow) return ch;
      const v = fullChars.get(ch.avatar);
      return v && !(v instanceof Promise) && !(v instanceof Error) ? v : null;
    };
    const fieldVals = (ch) => {
      const f = fullOf(ch);
      if (!f) return null;
      const src = f.data && typeof f.data === "object" ? f.data : f;
      return CHAR_FIELDS.map(([k]) => hashStr(stableJson(src[k] ?? f[k] ?? null)));
    };
    const need = allDups.flat().filter((ch) => ch.shallow && !fullChars.has(ch.avatar));
    if (need.length && !C.loadingFull) {
      C.loadingFull = true;
      Promise.allSettled(need.map((ch) => loadFullChar(ch.avatar))).then(() => { C.loadingFull = false; if (kind === "char" && !page.hidden) drawChars(); });
    }
    const pickList = chars.filter((ch) => sel.char.has(ch.avatar));
    body.innerHTML = String(html`
      ${sum(html`角色卡 <b>${chars.length}</b> 张 · ${dups.length ? html`<span class="cw-warn-text">同名 ${dups.length} 组</span>` : allDups.length ? "同名的都已忽略" : "没有同名"}${nIgnored && dups.length ? ` · 已忽略 ${nIgnored} 组` : ""}`,
        "<p>角色列表每次打开酒馆都要下载，删除重复的角色卡能减少一些。</p><p>同名角色卡逐项比较描述、性格、场景、开场白、示例对话、角色书、标签等文字内容，列出不同之处。不比较头像图片。</p><p>删除时保留聊天记录。正在聊天的角色卡不能勾选。</p><p>「忽略」：本次打开酒馆期间不再提示该组。「重新检测」：重新读取角色卡内容并比较。</p>",
        allDups.length || nIgnored ? html`<div class="cw-card-acts">${btn("重新检测", { act: "recheck", size: "sm", icon: "refresh", disabled: busy })}${dups.length > 1 ? btn("全部忽略", { act: "ignoreall", size: "sm", kind: "ghost" }) : ""}</div>` : "")}
      ${dups.length ? dups.map((g) => {
        const vals = g.map(fieldVals);
        const failed = g.some((ch) => fullChars.get(ch.avatar) instanceof Error);
        const unknown = vals.some((x) => x == null);
        const diff = unknown ? [] : CHAR_FIELDS.filter((_, i) => new Set(vals.map((v) => v[i])).size > 1).map(([, l]) => l);
        const same = !unknown && !diff.length;
        const keep = g.reduce((a, b) => (Number(b.date_last_chat) || 0) > (Number(a.date_last_chat) || 0) ? b : a);
        const label = same ? "文字设定相同（未比较头像图片）" : unknown ? (failed ? "读取失败，无法比较" : "正在读取内容…") : `不同之处：${diff.join("、")}`;
        return html`<section class="cw-cgroup"><div class="cw-cgroup-h"><b>${g[0].name}</b>${pill(label, same ? "warn" : "muted")}<span class="cw-gap"></span><button type="button" class="cw-link" data-act="ignore" data-g="${dupKey(g)}" title="这次打开酒馆期间不再提示这一组">忽略</button></div>
          <div class="cw-clist">${g.map((ch) => row({ key: ch.avatar, name: ch.avatar, locked: ch.avatar === cur, sizeText: ch.data_size ? fmtSize(ch.data_size) : "",
            tags: html`${ch.avatar === cur ? pill("正在聊天", "accent") : ""}${ch === keep && ch.date_last_chat ? pill("最近聊过", "ok") : ""}${ch.date_last_chat ? pill(relDay(Number(ch.date_last_chat)).replace("用过", "聊过")) : pill("没有聊过")}${ch.chat_size ? pill(`聊天 ${fmtSize(ch.chat_size)}`) : ""}` }))}</div></section>`;
      }) : empty(allDups.length ? "同名的角色卡都已忽略。" : "没有同名的角色卡。")}`);
    setBar(pickList.length, `已选 ${pickList.length} 张`, "删除时保留聊天记录", html`${btn("取消", { act: "none" })}${btn("删除", { act: "del", kind: "danger" })}`);
  }
  async function charClick(a, b, e) {
    if (a === "ignore") { e.preventDefault(); ignoredCharDups.add(b.dataset.g); return drawChars(); }
    if (a === "ignoreall") { for (const x of body.querySelectorAll('[data-act="ignore"]')) ignoredCharDups.add(x.dataset.g); return drawChars(); }
    if (a === "none") { sel.char.clear(); return drawChars(); }
    if (a === "recheck") {
      ignoredCharDups.clear();
      fullChars.clear();
      busy = true;
      drawChars();
      try { await ctx().getCharacters?.(); } catch {}
      busy = false;
      return drawChars();
    }
    if (a !== "del") return;
    const list = [...sel.char];
    if (!await confirmBox("删除角色卡", `将删除 ${list.length} 张角色卡（${list.slice(0, 3).join("、")}${list.length > 3 ? " 等" : ""}），聊天记录保留在服务器上。角色卡删除后无法在酒馆中恢复。`, "删除", true)) return;
    busy = true;
    let n = 0;
    const fail = [];
    for (const av of list) {
      try { await deleteCharacterKeepChats(av); sel.char.delete(av); n++; } catch (er) { fail.push(`${av}：${er.message}`); }
    }
    try { await ctx().getCharacters?.(); } catch {}
    busy = false;
    if (n) toast(`已删除 ${n} 张角色卡`, "success");
    if (fail.length) toast(fail.slice(0, 2).join("；"), "error");
    drawChars();
  }

  // ========== 世界书 ==========
  const W = { res: null, progress: "" };
  const wChars = () => ctx().characters || [];
  const fileBase = (av) => String(av || "").replace(/\.[^.]+$/, "");
  const charLore = () => { const lore = mods.wi?.world_info?.charLore; return Array.isArray(lore) ? lore : []; };
  const usage = () => {
    const out = {};
    const add = (n, w) => n && (out[n] ||= []).push(w);
    for (const n of mods.wi?.selected_world_info || []) add(n, "全局启用");
    for (const ch of wChars()) add(ch?.data?.extensions?.world, `角色「${ch.name}」绑定`);
    const byFile = new Map(wChars().map((ch) => [fileBase(ch.avatar), ch]));
    for (const l of charLore()) {
      const ch = byFile.get(l?.name);
      if (ch) for (const n of l.extraBooks || []) add(n, `角色「${ch.name}」附加`);
    }
    add(ctx().chatMetadata?.world_info, "当前聊天绑定");
    return out;
  };
  // 已删除角色卡留下的世界书：没人在用，且名为「X's Lorebook」（X 不是现有角色）、或带角色卡导入记录、或是已删角色的附加世界书
  const leftoverOf = (name, data, use) => {
    if (use[name]?.length) return null;
    const names = new Set(wChars().map((ch) => ch.name));
    const files = new Set(wChars().map((ch) => fileBase(ch.avatar)));
    const lore = charLore().find((l) => !files.has(l?.name) && (l.extraBooks || []).includes(name));
    if (lore) return { from: lore.name, why: "已删角色的附加世界书" };
    const m = /^(.+)'s Lorebook(?: \(\d+\))?$/.exec(name);
    if (m) return names.has(m[1]) ? null : { from: m[1], why: "角色卡已不在" };
    if (data?.originalData && typeof data.originalData === "object") {
      const own = [name, data.originalData.name].filter(Boolean);
      if (own.some((x) => names.has(x)) || wChars().some((ch) => own.includes(ch?.data?.character_book?.name))) return null;
      return { from: null, why: "来自角色卡，角色已不在" };
    }
    return null;
  };
  function drawWorld() {
    const names = listWorldbooks();
    const use = usage();
    const res = W.res;
    const wrow = (w, extra = "") => row({ key: w.name, name: w.name, sizeText: fmtSize(w.size), tags: html`${pill(`${w.n} 条`)}${raw(String(extra))}${(use[w.name] || []).slice(0, 2).map((u) => pill(u, "accent"))}` });
    let out = "";
    if (res) {
      const groups = [...res.byHash.values()].filter((g) => g.length > 1);
      const left = res.left.filter((w) => !use[w.name]?.length);
      const leftOff = left.filter((w) => !sel.world.has(w.name));
      out = html`${res.failed.length ? html`<p class="cw-warn-text">${res.failed.length} 本读取失败，没有参与比对：${res.failed.slice(0, 4).join("、")}${res.failed.length > 4 ? " 等" : ""}</p>` : ""}
        <section class="cw-cgroup"><div class="cw-cgroup-h"><b>条目完全相同</b><small class="cw-dim">${groups.length} 组</small></div>${groups.length ? groups.map((g) => html`<div class="cw-clist">${g.map((w) => wrow(w))}</div>`) : html`<p class="cw-hint">没有条目完全相同的世界书。</p>`}</section>
        ${res.empty.length ? html`<section class="cw-cgroup"><div class="cw-cgroup-h"><b>没有条目的世界书</b><small class="cw-dim">${res.empty.length} 本</small></div><div class="cw-clist">${res.empty.map((w) => wrow(w))}</div></section>` : ""}
        <section class="cw-cgroup"><div class="cw-cgroup-h"><b>已删除角色卡留下的</b><small class="cw-dim">${left.length} 本</small><span class="cw-gap"></span>${leftOff.length ? html`<button type="button" class="cw-link" data-act="pickleft">勾选 ${leftOff.length} 本</button>` : ""}</div>
          ${left.length ? html`<div class="cw-clist">${left.map((w) => wrow(w, pill(w.from ? `原角色「${w.from}」· ${w.why}` : w.why, "warn")))}</div>` : html`<p class="cw-hint">没有已删除角色卡留下的世界书。</p>`}</section>`;
    }
    body.innerHTML = String(html`
      ${sum(html`世界书 <b>${names.length}</b> 本`,
        "<p>世界书只在用到时才下载，删除不会让酒馆打开变快，只是更整齐。</p><p>检查要把全部世界书下载一遍，世界书多、网速慢时要等一会儿。找出三类：条目完全相同的、没有条目的、已删除角色卡留下的。删除时可先下载备份（zip）。</p><p>条目相同：比较每个条目的正文和全部设置（关键词、启用、概率、位置、深度等），只忽略条目编号和排列下标。</p><p>角色卡留下的：导入带世界书的角色卡时，酒馆会另存一本世界书，删除角色卡时不会一起删。列出没被任何现有角色、全局或当前聊天使用，且名为「某某's Lorebook」、或文件里有角色卡导入记录、或是已删角色附加的世界书。改过名的角色会被当成已删除；其他聊天绑定的世界书查不到，请看一眼名字再删。</p><p>标有「绑定」「附加」「全局启用」的世界书删除后，对应的角色或聊天将失去它。</p>",
        html`<div class="cw-card-acts">${btn(busy ? "检查中…" : res ? "重新检查" : "检查全部世界书", { act: "scan", size: "sm", icon: "search", kind: res ? "" : "primary", disabled: busy })}<small class="cw-dim">${W.progress}</small></div>`)}
      ${out}`);
    const n = sel.world.size;
    setBar(n, `已选 ${n} 本`, "", html`${btn("取消", { act: "none" })}${btn("删除", { act: "del", kind: "danger" })}`);
  }
  async function worldClick(a) {
    if (a === "none") { sel.world.clear(); return drawWorld(); }
    if (a === "scan") {
      busy = true;
      W.progress = "";
      drawWorld();
      const names = listWorldbooks();
      const byHash = new Map(), emptyList = [], failed = [], left = [];
      const use = usage();
      W.res = null;
      for (const [i, n] of names.entries()) {
        W.progress = `正在读取 ${i + 1}/${names.length}：${n}`;
        const p = body.querySelector(".cw-sum .cw-card-acts small");
        if (p) p.textContent = W.progress;
        try {
          const data = await mods.wi.loadWorldInfo(n);
          const list = wiSorted(data);
          const w = { name: n, n: list.length, size: jsonSize(data) };
          const lo = leftoverOf(n, data, use);
          if (lo) left.push({ ...w, ...lo });
          if (!list.length) { emptyList.push(w); continue; }
          // 比较条目的全部设置，只忽略编号和排列下标
          const h = hashStr(JSON.stringify(list.map((e2) => { const { uid: _u, displayIndex: _d, ...rest } = e2; return stableJson(rest); })));
          (byHash.get(h) || byHash.set(h, []).get(h)).push(w);
        } catch {
          failed.push(n);
        }
      }
      W.res = { byHash, empty: emptyList, failed, left };
      W.progress = "";
      busy = false;
      return drawWorld();
    }
    if (a === "pickleft") {
      const use = usage();
      for (const w of W.res?.left || []) if (!use[w.name]?.length) sel.world.add(w.name);
      return drawWorld();
    }
    if (a === "del") {
      const list = [...sel.world];
      const use = usage();
      const bound = list.filter((n) => use[n]?.length);
      const names = `${list.slice(0, 4).join("、")}${list.length > 4 ? " 等" : ""}`;
      const usedNote = bound.length ? `其中 ${bound.join("、")} 正被使用，删除后对应的角色或聊天将失去它。` : "";
      const go = await confirmDeleteOfferBackup("删除世界书", String(html`<p class="cw-p">将删除 ${list.length} 本世界书：${names}。删除后不能恢复，需要的话先下载备份。${usedNote}</p>`), async () => {
        const files = [], unread = [];
        for (const n of list) {
          try {
            const data = await mods.wi.loadWorldInfo(n);
            if (!data || typeof data !== "object") throw new Error("读取结果为空");
            files.push({ name: `${n}.json`, data: JSON.stringify(data, null, 2) });
          } catch {
            unread.push(n);
          }
        }
        const fname = `worldbooks-backup-${cleanStamp()}.zip`;
        if (files.length) downloadBlob(makeZip(files), fname);
        return `${files.length ? `已让浏览器下载「${esc(fname)}」，可在下载记录里确认。` : ""}${unread.length ? `${esc(unread.join("、"))} 读取失败，没有备份进去。` : ""}`;
      });
      if (!go) return;
      busy = true;
      let ok = 0;
      const fail = [];
      for (const n of list) {
        try { await deleteWorldbook(n); sel.world.delete(n); ok++; } catch (er) { fail.push(`「${n}」${er.message}`); }
      }
      if (fail.length) toast(`${fail.length} 本没有删除：${fail.slice(0, 3).join("；")}${fail.length > 3 ? " 等" : ""}`, "error");
      const res = W.res;
      if (res) {
        const has = new Set(listWorldbooks());
        for (const g of res.byHash.values()) for (let i = g.length - 1; i >= 0; i--) if (!has.has(g[i].name)) g.splice(i, 1);
        res.empty = res.empty.filter((w) => has.has(w.name));
        res.left = res.left.filter((w) => has.has(w.name));
        res.failed = res.failed.filter((n) => has.has(n));
      }
      busy = false;
      if (ok) toast(`已删除 ${ok} 本世界书`, "success");
      return drawWorld();
    }
  }

  // ---------- 切栏与事件 ----------
  function draw() {
    if (kind === "preset") return P.scanned ? drawPresets() : renderPresets();
    if (kind === "ext") return drawExt();
    if (kind === "char") return drawChars();
    return drawWorld();
  }
  page.querySelector(".cw-pagehead").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b || busy || b.dataset.kind === kind) return;
    kind = b.dataset.kind;
    page.querySelectorAll("[data-kind]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
    bar.hidden = true;
    page.querySelector(".cw-body").scrollTop = 0;
    if (kind === "preset") return renderPresets();
    if (kind === "ext" && !X.exts && !X.loading) {
      X.loading = true;
      discoverExtensions().then((x) => { X.exts = x; }).catch((er) => { X.err = er.message; }).finally(() => { X.loading = false; if (kind === "ext") drawExt(); });
    }
    draw();
  });
  // 折叠组的展开状态在重画后保留
  page.addEventListener("toggle", (e) => {
    const g = e.target.closest?.("[data-pair]");
    if (g) g.open ? P.pairOpen.add(g.dataset.pair) : P.pairOpen.delete(g.dataset.pair);
  }, true);
  page.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.act !== "pick") return;
    if (t.checked) S().add(t.dataset.k);
    else S().delete(t.dataset.k);
    draw();
  });
  page.addEventListener("click", async (e) => {
    const f = e.target.closest("[data-filter]");
    if (f && kind === "preset") { P.filter = f.dataset.filter; return drawPresets(); }
    const b = e.target.closest("button[data-act]");
    if (!b || busy || b.dataset.act === "pick") return;
    const a = b.dataset.act;
    if (kind === "preset") return presetClick(a, b);
    if (kind === "ext") return extClick(a);
    if (kind === "char") return charClick(a, b, e);
    return worldClick(a);
  });
  // 清理页可由体检的「去清理」直达某一栏
  function setView(v) {
    const b = page.querySelector(`[data-kind="${v}"]`);
    if (b && v !== kind) b.click();
  }
  return { render: () => { if (kind === "preset") renderPresets(); else draw(); }, setView };
}
