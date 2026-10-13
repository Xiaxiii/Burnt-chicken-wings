// 1.5.0「清理」页：看清每个预设占多少、哪些可以清理；归档到服务器（打开时不再下载）、随时恢复。
// 归档文件放在酒馆的「用户文件」目录，清单记在本扩展的设置里，换设备、换浏览器都能看到和恢复。

// 记录每个预设最近一次被选用的时间（酒馆本身不记）。只记名称和时间。
function notePresetUse(name, { save = true } = {}) {
  if (!name) return;
  const s = settings();
  if (!s.presetUse || typeof s.presetUse !== "object") s.presetUse = {};
  if (!s.presetUseSince) s.presetUseSince = Date.now();
  s.presetUse[name] = Date.now();
  if (save) saveSettings();
}
function archiveList() {
  const s = settings();
  if (!Array.isArray(s.archive)) s.archive = [];
  return s.archive;
}
function relDay(t) {
  if (!t) return "";
  const d = Math.floor((Date.now() - t) / 864e5);
  return d <= 0 ? "今天用过" : d === 1 ? "昨天用过" : `${d} 天前用过`;
}
function dateStr(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// 哪些预设被方案或酒馆的「连接配置」用着
function presetUsers() {
  const out = {};
  const add = (n, why) => (out[n] ||= []).push(why);
  for (const s of settings().schemes || []) if (s.preset) add(s.preset, `方案「${s.name}」`);
  for (const p of ctx().extensionSettings?.connectionManager?.profiles || []) if (p?.preset) add(p.preset, `连接配置「${p.name}」`);
  return out;
}
function presetText(name) {
  const { presets } = pm().getPresetList();
  const idx = presetIndex(name);
  const data = name === currentPresetName() ? readPreset(name) : presets[idx];
  return JSON.stringify(data ?? null);
}
// 从归档恢复一个预设。被方案套用时也会调用（方案对应的预设已归档 → 自动恢复后再切换）。
async function restoreArchived(entry, { ask = true } = {}) {
  const text = await userFileGetText(entry.path, entry.gz);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("归档文件已损坏，无法读取");
  }
  if (listPresets().includes(entry.name)) {
    if (ask && !await confirmBox("已有同名预设", `预设文件夹中已有「${entry.name}」。恢复会用归档的版本覆盖它，是否继续？`, "覆盖")) return false;
  }
  await restorePresetFile(entry.name, data);
  const list = archiveList();
  const i = list.indexOf(entry);
  if (i >= 0) list.splice(i, 1);
  saveSettings();
  await userFileDel(entry.path).catch((e) => console.warn("[裁缝铺] 归档文件删除失败", e));
  dropDraft(entry.name);
  return true;
}
async function restoreArchivedByName(name) {
  const e = archiveList().find((x) => x.name === name);
  if (!e) return false;
  toast(`正在从归档恢复「${name}」…`);
  return restoreArchived(e, { ask: false });
}
function mountCleanup(sec) {
  // 1.7.0：分栏——预设 / 扩展数据 / 角色卡 / 世界书 / 本地备份
  const KINDS = [["preset", "预设"], ["ext", "扩展数据"], ["char", "角色卡"], ["world", "世界书"], ["local", "本地备份"]];
  sec.innerHTML = `<div class="pa-scroll pa-clean"><div class="pa-ckinds"><div class="pa-seg pa-seg-s" role="tablist">${KINDS.map(([k, l]) => `<button data-kind="${k}" class="${k === "preset" ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="pa-clean-body"><p class="pa-hint">正在分析预设…</p></div><div class="pa-clean-other" hidden></div></div>
    <div class="pa-movebar pa-clean-act" hidden></div>`;
  const body = sec.querySelector(".pa-clean-body");
  const act = sec.querySelector(".pa-clean-act");
  const st = { filter: null, sort: "size", sel: new Set(), rows: [], busy: false, open: new Set(), kind: "preset" };
  sec.querySelector(".pa-ckinds").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b || st.busy) return;
    st.kind = b.dataset.kind;
    sec.querySelectorAll("[data-kind]").forEach((x) => x.classList.toggle("on", x === b));
    const other = sec.querySelector(".pa-clean-other");
    body.hidden = st.kind !== "preset";
    other.hidden = st.kind === "preset";
    if (st.kind === "preset") return render();
    act.hidden = true;
    // 每次换栏都换一个新容器，事件不会叠加
    const fresh = document.createElement("div");
    fresh.className = "pa-clean-other";
    other.replaceWith(fresh);
    mountCleanKind(st.kind, fresh);
  });
  const MB = 1024 * 1024;
  // 估算：勾选的预设一共能让打开快多少（按本次打开实测的压缩比例和速度）
  function estimate(bytes) {
    try {
      const m = measureLoad();
      const raw = st.rows.reduce((n, r) => n + r.size, 0) + jsonSize(ctx().extensionSettings);
      if (!m.settingsOnce || !m.bandwidth || !raw) return null;
      const wire = bytes * (m.settingsOnce / raw);
      return { wire, secs: wire / m.bandwidth, times: m.settingsCount };
    } catch {
      return null;
    }
  }
  async function scan() {
    const names = listPresets();
    const { presets } = pm().getPresetList();
    const cur = currentPresetName();
    const list = [];
    for (const n of names) {
      let text;
      try {
        text = n === cur ? presetText(n) : JSON.stringify(presets[presetIndex(n)] ?? null);
      } catch {
        continue;
      }
      // 不再 JSON.parse 一份副本：77 个预设会多占几十 MB 内存，iOS 内存紧张时会直接刷新页面
      // 文本只用来算大小和指纹，算完就丢
      list.push({ name: n, data: n === cur ? JSON.parse(text) : presets[presetIndex(n)], full: hashStr(text), size: new Blob([text]).size });
      if (list.length % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    st.rows = scanPresets(list, { current: cur, inUse: presetUsers(), lastUse: settings().presetUse || {} });
    for (const n of [...st.sel]) if (!st.rows.some((r) => r.name === n && !r.current)) st.sel.delete(n);
    if (!st.filter) st.filter = st.rows.some((r) => r.suggest) ? "suggest" : "all";
  }
  function view() {
    let rows = st.filter === "suggest" ? st.rows.filter((r) => r.suggest) : st.rows;
    const by = {
      size: (a, b) => b.size - a.size,
      name: (a, b) => a.name.localeCompare(b.name, "zh"),
      used: (a, b) => (a.lastUse || 0) - (b.lastUse || 0) || b.size - a.size
    }[st.sort];
    return [...rows].sort(by);
  }
  function draw() {
    const all = st.rows;
    const total = all.reduce((n, r) => n + r.size, 0);
    const sugg = all.filter((r) => r.suggest);
    const suggSize = sugg.reduce((n, r) => n + r.size, 0);
    const arch = archiveList();
    const archSize = arch.reduce((n, a) => n + (a.size || 0), 0);
    const est = estimate(total);
    const max = all[0] ? Math.max(...all.map((r) => r.size)) : 1;
    const since = settings().presetUseSince;
    const tagChip = (t) => `<span class="pa-chip pa-ctag-${t.k}" title="${esc(t.t)}">${esc(t.t)}</span>`;
    const row = (r) => `<label class="pa-crow${r.current ? " pa-locked" : ""}${st.sel.has(r.name) ? " on" : ""}">
        <input type="checkbox" data-c="pick" data-n="${esc(r.name)}" ${r.current ? "disabled" : ""} ${st.sel.has(r.name) ? "checked" : ""}>
        <span class="pa-crow-main"><b>${esc(r.name)}</b><span class="pa-crow-tags">${r.current ? '<span class="pa-chip pa-chip-cot">当前使用</span>' : ""}${r.tags.map(tagChip).join("")}${r.inUse.map((w) => `<span class="pa-chip pa-ctag-use" title="${esc(w)}在用">${esc(w)}在用</span>`).join("")}${r.lastUse ? `<span class="pa-chip pa-chip-dim">${relDay(r.lastUse)}</span>` : since && Date.now() - since > 7 * 864e5 ? '<span class="pa-chip pa-chip-dim">开始记录后未用过</span>' : ""}</span></span>
        <span class="pa-crow-size"><i class="pa-bar"><b style="width:${Math.max(2, Math.round(r.size / max * 100))}%"></b></i><em>${fmtSize(r.size)}</em></span>
      </label>`;
    const archRow = (a, i) => `<div class="pa-crow pa-crow-arch">
        <span class="pa-crow-main"><b>${esc(a.name)}</b><span class="pa-crow-tags"><span class="pa-chip pa-chip-dim">${dateStr(a.at)} 归档</span></span></span>
        <span class="pa-crow-size"><em>${fmtSize(a.size || 0)}</em></span>
        <span class="pa-crow-btns"><button class="pa-btn pa-btn-s pa-btn-soft" data-c="restore" data-i="${i}">恢复</button><button class="pa-btn pa-btn-s" data-c="adl" data-i="${i}">下载</button><button class="pa-btn pa-btn-s pa-btn-danger-soft" data-c="adel" data-i="${i}">删除</button></span>
      </div>`;
    const list = view();
    body.innerHTML = `
      <div class="pa-verdict ${sugg.length ? "pa-bad" : "pa-good"}">
        <p>预设文件夹中有 <b>${all.length}</b> 个预设，共 <b>${fmtSize(total)}</b>，酒馆每次打开都会全部下载${est ? `（压缩传输约 ${fmtSize(est.wire)}，按本次实测速度约 ${fmtMs(est.secs * 1000)}${est.times > 1 ? `；本次下载了 ${est.times} 次` : ""}）` : ""}。</p>
        ${sugg.length ? `<p>其中 <b>${sugg.length}</b> 个可考虑清理，共 <b>${fmtSize(suggSize)}</b>。</p>` : "<p>没有发现重复或旧版本的预设。</p>"}
        ${arch.length ? `<p>已归档 ${arch.length} 个（${fmtSize(archSize)}），打开时不再下载。</p>` : ""}
        <div class="pa-stack" aria-hidden="true">${[...all].sort((a, b) => (b.suggest - a.suggest) || (b.size - a.size)).map((r) => `<i class="${st.sel.has(r.name) ? "sel" : r.suggest ? "sug" : ""}" style="flex-grow:${r.size}" title="${esc(r.name)} ${fmtSize(r.size)}"></i>`).join("")}</div>
        <div class="pa-stack-key"><span><i class="sug"></i>可考虑清理</span><span><i></i>其余预设</span><span><i class="sel"></i>已勾选</span></div>
      </div>
      <div class="pa-clean-bar">
        <div class="pa-seg pa-seg-s" role="tablist">
          <button data-f="suggest" class="${st.filter === "suggest" ? "on" : ""}">可清理 ${sugg.length}</button>
          <button data-f="all" class="${st.filter === "all" ? "on" : ""}">全部 ${all.length}</button>
          <button data-f="arch" class="${st.filter === "arch" ? "on" : ""}">已归档 ${arch.length}</button>
        </div>
        ${st.filter !== "arch" ? `<select class="pa-select pa-select-s" data-c="sort" aria-label="排序">
          <option value="size" ${st.sort === "size" ? "selected" : ""}>按大小</option>
          <option value="used" ${st.sort === "used" ? "selected" : ""}>按最近使用</option>
          <option value="name" ${st.sort === "name" ? "selected" : ""}>按名称</option></select>` : ""}
      </div>
      ${st.filter === "arch" ? arch.length ? `<div class="pa-clist">${arch.map(archRow).join("")}</div><p class="pa-hint">归档文件保存在酒馆服务器的用户文件目录，换设备、换浏览器都能恢复。恢复后回到预设列表，归档文件随之删除。</p>` : '<p class="pa-empty">还没有归档的预设。</p>'
        : `${list.length ? `<div class="pa-clist-head"><button class="pa-link" data-c="all">${list.filter((r) => !r.current).every((r) => st.sel.has(r.name)) ? "取消全选" : "全选本页"}</button></div><div class="pa-clist">${list.map(row).join("")}</div>` : '<p class="pa-empty">没有可清理的预设。</p>'}
      <details class="pa-clean-help"><summary>标签说明</summary>
        <ul class="pa-legend">
          <li><span class="pa-chip pa-ctag-same">完全相同</span><span>与另一个预设内容一字不差，保留一个即可。</span></li>
          <li><span class="pa-chip pa-ctag-old">有新版</span><span>名称相同、版本号更低。</span></li>
          <li><span class="pa-chip pa-ctag-series">同系列</span><span>名称只差「_json」「(1)」「副本」等后缀。</span></li>
          <li><span class="pa-chip pa-ctag-near">条目相同</span><span>与另一个预设的大部分条目内容相同，可能是改版或旧版。</span></li>
          <li><span class="pa-chip pa-ctag-use">在用</span><span>被方案或酒馆的连接配置使用。归档后套用这些方案时会自动恢复。</span></li>
        </ul>
        <p class="pa-hint">「几天前用过」从本版本开始记录。标签只是提示，清理哪些由你决定；正在使用的预设不能勾选。</p>
      </details>`}`;
    drawBar();
  }
  function drawBar() {
    const pick = st.rows.filter((r) => st.sel.has(r.name));
    act.hidden = !pick.length || st.filter === "arch";
    if (act.hidden) return;
    const size = pick.reduce((n, r) => n + r.size, 0);
    const est = estimate(size);
    act.innerHTML = `<b>已选 ${pick.length} 个 · ${fmtSize(size)}${est && est.secs >= 1 ? ` · 打开约快 ${fmtMs(est.secs * est.times * 1000)}` : ""}</b>
      <button class="pa-btn" data-c="none">取消</button>
      <button class="pa-btn" data-c="dl">下载</button>
      <button class="pa-btn pa-btn-danger-soft" data-c="del">删除</button>
      <button class="pa-btn pa-btn-primary" data-c="arch">归档</button>
      <small>归档：移出预设文件夹，存到服务器的用户文件目录，打开酒馆时不再下载，可随时恢复。</small>`;
  }
  async function render() {
    if (st.busy || st.kind !== "preset") return;
    try {
      await scan();
    } catch (e) {
      body.innerHTML = `<p class="pa-warn">分析出错：${esc(e.message)}</p>`;
      return;
    }
    draw();
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  function zipOf(names) {
    return makeZip(names.map((n) => ({ name: `${n}.json`, data: JSON.stringify(JSON.parse(presetText(n)), null, 4) })));
  }
  function busy(on, text) {
    st.busy = on;
    act.querySelectorAll("button").forEach((b) => { b.disabled = on; });
    if (text) act.querySelector("b").textContent = text;
  }
  const usersOf = (names) => names.flatMap((n) => (presetUsers()[n] || []).map((w) => `${w}（${n}）`));
  async function doArchive(names) {
    const users = usersOf(names);
    const size = st.rows.filter((r) => names.includes(r.name)).reduce((n, r) => n + r.size, 0);
    const ok = await sheet({
      title: `归档 ${names.length} 个预设`,
      body: `<p class="pa-p">共 ${fmtSize(size)}。归档后这些预设不再出现在酒馆的预设列表中，打开酒馆时也不再下载；在「清理 → 已归档」中可随时恢复。</p>
        ${users.length ? `<p class="pa-p pa-dim">${esc(users.slice(0, 4).join("、"))}${users.length > 4 ? ` 等 ${users.length} 处` : ""}使用了这些预设。${users.some((w) => w.startsWith("方案")) ? "套用相应方案时会自动从归档恢复。" : ""}${users.some((w) => w.startsWith("连接配置")) ? "酒馆的连接配置不会自动恢复，使用前需先在这里恢复。" : ""}</p>` : ""}
        <label class="pa-cbox"><input type="checkbox" data-zip checked> 同时下载一份到本地（zip）</label>`,
      actions: [{ label: "取消", value: null }, { label: "归档", kind: "primary", value: (w) => ({ zip: w.querySelector("[data-zip]").checked }) }]
    });
    if (!ok) return;
    if (ok.zip) downloadBlob(zipOf(names), `preset-archive-${stamp()}.zip`);
    const done = [], fail = [];
    for (const [i, n] of names.entries()) {
      busy(true, `正在归档 ${i + 1}/${names.length}：${n}`);
      let path = null;
      try {
        if (drafts.get(n)?.dirty) await saveDraft(n, "归档前保存");
        const text = presetText(n);
        const gz = await gzipText(text);
        const fname = `pa-preset-${hashStr(n + text).slice(0, 12)}-${Date.now().toString(36)}.json${gz ? ".gz" : ""}`;
        path = await userFilePut(fname, gz || new Blob([text], { type: "application/json" }));
        if (await userFileExists(path) === false) throw new Error("上传后在服务器上找不到文件");
        await deletePresetFile(n);
        const list = archiveList();
        const old = list.filter((x) => x.name === n);
        list.push({ id: Date.now().toString(36) + i, name: n, path, gz: !!gz, size: new Blob([text]).size, at: Date.now() });
        for (const o of old) {
          list.splice(list.indexOf(o), 1);
          userFileDel(o.path).catch(() => {});
        }
        saveSettings();
        dropDraft(n);
        st.sel.delete(n);
        done.push(n);
      } catch (e) {
        console.warn("[裁缝铺] 归档失败", n, e);
        // 已上传但没删掉预设：把上传的文件删掉，保持原样
        if (path && listPresets().includes(n)) userFileDel(path).catch(() => {});
        fail.push(`${n}：${e.message}`);
      }
    }
    busy(false);
    if (done.length) toast(`已归档 ${done.length} 个预设`, "success");
    if (fail.length) toast(`${fail.length} 个归档失败（预设保持原样）：${fail.slice(0, 2).join("；")}`, "error");
    emitChange(currentPresetName());
    render();
  }
  async function doDelete(names) {
    const ok = await sheet({
      title: `删除 ${names.length} 个预设`,
      body: `<p class="pa-p">将从服务器上删除这些预设，<b>删除后无法在酒馆中恢复</b>。如果以后可能还会用到，建议改用「归档」。</p>
        <label class="pa-cbox"><input type="checkbox" data-zip checked> 删除前先下载一份到本地（zip）</label>`,
      actions: [{ label: "取消", value: null }, { label: "删除", kind: "danger", value: (w) => ({ zip: w.querySelector("[data-zip]").checked }) }]
    });
    if (!ok) return;
    if (ok.zip) downloadBlob(zipOf(names), `preset-backup-${stamp()}.zip`);
    let n = 0;
    const fail = [];
    for (const [i, name] of names.entries()) {
      busy(true, `正在删除 ${i + 1}/${names.length}：${name}`);
      try {
        await deletePresetFile(name);
        dropDraft(name);
        st.sel.delete(name);
        n++;
      } catch (e) {
        fail.push(`${name}：${e.message}`);
      }
    }
    busy(false);
    if (n) toast(`已删除 ${n} 个预设`, "success");
    if (fail.length) toast(`${fail.length} 个删除失败：${fail.slice(0, 2).join("；")}`, "error");
    emitChange(currentPresetName());
    render();
  }
  sec.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-c=pick]")) {
      if (t.checked) st.sel.add(t.dataset.n);
      else st.sel.delete(t.dataset.n);
      t.closest(".pa-crow")?.classList.toggle("on", t.checked);
      draw();
    } else if (t.matches("[data-c=sort]")) {
      st.sort = t.value;
      draw();
    }
  });
  sec.addEventListener("click", async (e) => {
    const f = e.target.closest("[data-f]");
    if (f) {
      st.filter = f.dataset.f;
      return draw();
    }
    const b = e.target.closest("button[data-c]");
    if (!b || st.busy) return;
    const c = b.dataset.c;
    const names = st.rows.filter((r) => st.sel.has(r.name)).map((r) => r.name);
    if (c === "all") {
      const vis = view().filter((r) => !r.current);
      const allOn = vis.every((r) => st.sel.has(r.name));
      for (const r of vis) allOn ? st.sel.delete(r.name) : st.sel.add(r.name);
      return draw();
    }
    if (c === "none") {
      st.sel.clear();
      return draw();
    }
    if (c === "dl") return downloadBlob(zipOf(names), `presets-${stamp()}.zip`);
    if (c === "arch") return doArchive(names);
    if (c === "del") return doDelete(names);
    const a = archiveList()[Number(b.dataset.i)];
    if (!a) return;
    b.disabled = true;
    try {
      if (c === "restore") {
        if (await restoreArchived(a)) toast(`已恢复「${a.name}」`, "success");
        emitChange(currentPresetName());
        await render();
      } else if (c === "adl") {
        const text = await userFileGetText(a.path, a.gz);
        downloadBlob(new Blob([JSON.stringify(JSON.parse(text), null, 4)], { type: "application/json" }), `${a.name}.json`);
      } else if (c === "adel") {
        if (!await confirmBox("删除归档", `将从服务器上删除「${a.name}」的归档文件，删除后无法恢复。`, "删除", true)) return;
        await userFileDel(a.path);
        const list = archiveList();
        list.splice(list.indexOf(a), 1);
        saveSettings();
        draw();
      }
    } catch (err) {
      toast(err.message, "error");
    } finally {
      b.disabled = false;
    }
  });
  return { render };
}
