// 模型选择窗口：单密钥和多密钥站点共用。
// 视图：按模型平铺；按分类（自建分类在前，其余按系列自动分段）；按分组（多密钥，一个分组一段）。
// 自建分类记在站点上（site.modelCats），一个模型可在几个分类里；多选可新建分类或加入已有分类。
// 多密钥站点的模型后面标出哪些分组有它：点模型名用排在上面的分组，点分组标签换；超过 2 个收成「+N」。
// 段落展开记在 fold.mpick（按站点）。返回：单密钥为模型名，多密钥为 { model, keyId }，取消为 null
async function modelPicker({ site = null, keys = null, list = [], cur = "", curKey = null, title = "选择模型" }) {
  const multi = Array.isArray(keys) && keys.length > 1;
  const kname = (k) => keyName(site, k);
  // 当前模型不在这个站点的列表里时不混进列表；列表为空时才列出当前模型
  const all = multi ? [...new Set(keys.flatMap((k) => k.models || []))] : [...new Set((list.length ? list : [cur]).filter(Boolean))];
  const allSet = new Set(all);
  const ownersOf = new Map(all.map((m) => [m, []]));
  if (multi) for (const k of keys) for (const m of new Set(k.models || [])) ownersOf.get(m).push(k);
  const cats = () => site?.modelCats || [];
  const fams = () => familyGroups(all.filter((m) => !cats().some((c) => c.models.includes(m))));
  const canCat = !!site || familyGroups(all).length > 1;
  const views = [["model", "按模型"], ...canCat ? [["cat", "按分类"]] : [], ...multi ? [["group", "按分组"]] : []];
  const saved = (site && (multi || site.modelView) ? site.modelView : settings().modelView) || "";
  let mode = { family: "cat", cat: "cat", group: "group" }[saved] || "model";
  if (!views.some(([v]) => v === mode)) mode = "model";
  const firstCat = cats().find((c) => c.models.includes(cur));
  const secDefault = new Set([multi ? keys[0].id : "", firstCat ? `c:${firstCat.id}` : `f:${modelFamily(cur || all[0])}`]);
  const secKey = (id) => `${site?.id || "live"}\u0001${id}`;
  const secOpen = {
    has: (id) => foldGet("mpick", secKey(id), secDefault.has(id)),
    set: (id, on) => foldSet("mpick", secKey(id), on, 300)
  };
  const more = new Set();
  let selecting = false;
  let editing = null;
  const sel = new Set();
  let picked = null;
  const body = el(html`<div class="cw-mpick">
      <div class="cw-mpick-top">
        ${views.length > 1 ? segHtml(views, mode, { attr: "data-view", label: "模型显示方式", size: "sm" }) : ""}
        <div class="cw-mpick-find"><span class="cw-search">${iconHtml("search")}<input class="cw-input" type="text" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="搜索，或输入模型名称" aria-label="搜索模型"></span>${site ? btn("多选", { act: "selmode", size: "sm" }) : ""}</div>
        <div class="cw-mpick-sel" hidden><span class="cw-mpick-cnt"></span><button type="button" class="cw-link" data-act="selall"></button><button type="button" class="cw-link" data-act="selnone">清空</button><span class="cw-gap"></span><span class="cw-mpick-acts"></span>
          <div class="cw-mpick-new" hidden><input class="cw-input" placeholder="分类名，如 Gemini 逆向、0.07/次" maxlength="60" aria-label="新分类名">${btn("取消", { act: "newcancel", size: "sm" })}${btn("确定", { act: "newok", size: "sm", kind: "primary" })}</div></div>
        ${!multi && cur && list.length && !allSet.has(cur) ? html`<p class="cw-hint">当前模型「${cur}」不在此站点的列表中</p>` : ""}
      </div>
      <div class="cw-mpick-list" role="listbox" aria-label="模型"></div></div>`);
  const input = body.querySelector(".cw-mpick-find input");
  const box = body.querySelector(".cw-mpick-list");
  const query = () => input.value.trim();
  const hit = (m) => { const q = query().toLowerCase(); return !q || m.toLowerCase().includes(q); };
  const chip = (m, k) => {
    const on = m === cur && k.id === curKey;
    return html`<button type="button" class="cw-kchip${on ? " on" : ""}" data-m="${m}" data-k="${k.id}" aria-pressed="${String(on)}">${kname(k)}</button>`;
  };
  const selRow = (m) => html`<button type="button" class="cw-choice cw-mrow-sel${sel.has(m) ? " is-sel" : ""}" data-sel="${m}" aria-pressed="${String(sel.has(m))}"><span class="cw-tick" aria-hidden="true"></span><span>${m}</span></button>`;
  const plainRow = (m, k = null) => {
    const on = m === cur && (!multi || k?.id === curKey);
    return html`<button type="button" class="cw-choice${on ? " on" : ""}" role="option" aria-selected="${String(on)}" data-m="${m}"${k ? raw(` data-k="${esc(k.id)}"`) : ""}><span>${m}</span>${on ? iconHtml("check") : ""}</button>`;
  };
  const keyRow = (m) => {
    const owners = ownersOf.get(m);
    const on = m === cur;
    let tail;
    if (owners.length <= 2) tail = owners.map((k) => chip(m, k));
    else if (more.has(m)) tail = html`${owners.map((k) => chip(m, k))}<button type="button" class="cw-kmore" data-more="${m}" aria-expanded="true">收起</button>`;
    else {
      const shown = owners.find((k) => on && k.id === curKey) || owners[0];
      tail = html`${chip(m, shown)}<button type="button" class="cw-kmore" data-more="${m}" aria-expanded="false" aria-label="还有 ${owners.length - 1} 个分组">+${owners.length - 1}</button>`;
    }
    return html`<div class="cw-krow${on ? " on" : ""}"><button type="button" class="cw-kname" data-m="${m}" data-k="${owners[0].id}">${m}${on ? iconHtml("check") : ""}</button><span class="cw-kchips">${tail}</span></div>`;
  };
  const row = (m) => selecting ? selRow(m) : multi ? keyRow(m) : plainRow(m);
  const custom = (k = null) => {
    const q = query();
    return !selecting && q && !(k ? (k.models || []).includes(q) : allSet.has(q)) ? html`<button type="button" class="cw-choice cw-mrow-custom" data-m="${q}"${multi ? raw(` data-k="${esc((k || keys[0]).id)}"`) : ""}>${iconHtml("plus")}<span>使用「${q}」</span></button>` : "";
  };
  const secHead = (id, label, n, open, sub = "", menu = "") => html`<div class="cw-msec"><button type="button" class="cw-msec-h" data-fold="${id}" aria-expanded="${String(open)}">${iconHtml(open ? "chevDown" : "chev")}<b>${label}</b>${sub ? html`<small>${sub}</small>` : ""}<span class="cw-msec-n">${n}</span></button>${menu}</div>`;
  const none = html`<p class="cw-hint cw-pad">没有匹配的模型，可直接输入名称</p>`;
  const paint = () => {
    body.querySelectorAll("[data-view]").forEach((b) => { b.classList.toggle("on", b.dataset.view === mode); b.setAttribute("aria-selected", b.dataset.view === mode); });
    const q = query();
    let out;
    if (mode === "model") {
      const rows = all.filter(hit);
      out = html`${custom()}${rows.map(row)}`;
      if (!rows.length && !custom()) out = none;
    } else if (mode === "cat") {
      const parts = [];
      for (const c of cats()) {
        const present = c.models.filter((m) => allSet.has(m));
        const ms = present.filter(hit);
        if (q && !ms.length) continue;
        const id = `c:${c.id}`;
        const open = !!q || secOpen.has(id);
        parts.push(html`${secHead(id, c.name, present.length, open, "", ibtn("more", `分类「${c.name}」的操作`, { attrs: `data-catmenu="${esc(c.id)}"` }))}${open ? ms.map(row) : ""}`);
      }
      for (const f of fams()) {
        const ms = f.list.filter(hit);
        if (q && !ms.length) continue;
        const id = `f:${f.name}`;
        const open = !!q || secOpen.has(id);
        parts.push(html`${secHead(id, f.name, f.list.length, open, cats().length ? "自动" : "")}${open ? ms.map(row) : ""}`);
      }
      out = parts.length || custom() ? html`${custom()}${parts}` : none;
    } else {
      out = keys.map((k) => {
        const ms = (k.models || []).filter(hit);
        const open = !!q || secOpen.has(k.id);
        const items = ms.map((m) => selecting ? selRow(m) : plainRow(m, k));
        const kc = custom(k);
        const blank = !ms.length && !kc ? html`<p class="cw-hint cw-pad">${(k.models || []).length ? "没有匹配的模型" : "还没有模型列表，可在搜索框输入模型名称"}</p>` : "";
        return html`${secHead(k.id, kname(k), (k.models || []).length, open, k.keyMask || "")}${open ? html`${kc}${items}${blank}` : ""}`;
      });
    }
    box.innerHTML = String(out);
    const bar = body.querySelector(".cw-mpick-sel");
    bar.hidden = !selecting;
    if (!selecting) bar.querySelector(".cw-mpick-new").hidden = true;
    const sb = body.querySelector('[data-act="selmode"]');
    if (sb) { sb.querySelector("span").textContent = selecting ? "取消多选" : "多选"; sb.setAttribute("aria-pressed", selecting); }
    if (selecting) {
      const n = all.filter(hit).length;
      bar.querySelector('[data-act="selall"]').textContent = q ? `全选搜索结果（${n}）` : `全选（${n}）`;
      bar.querySelector('[data-act="selnone"]').hidden = !sel.size;
      bar.querySelector(".cw-mpick-cnt").textContent = editing ? `「${editing.name}」已选 ${sel.size}` : `已选 ${sel.size}`;
      bar.querySelector(".cw-mpick-acts").innerHTML = String(editing
        ? html`${btn("取消", { act: "cancel", size: "sm" })}${btn("保存", { act: "save", size: "sm", kind: "primary" })}`
        : html`${cats().length ? btn("加入…", { act: "addto", size: "sm" }) : ""}${btn("新建分类", { act: "newcat", size: "sm", kind: "primary" })}`);
    }
  };
  const stopSelect = () => { selecting = false; editing = null; sel.clear(); };
  const saveCats = () => { if (!site.modelCats) site.modelCats = []; saveSettings(); };
  onSearchInput(input, paint, all.length > 150 ? 120 : 0);
  paint();
  await dialog({ title: `${title}（${all.length}）`, body, noFocus: true, size: all.length > 10 ? "tall" : "md", cls: "cw-dlg-picker", actions: [], onMount: (w) => {
    const newBox = body.querySelector(".cw-mpick-new");
    const newInput = newBox.querySelector("input");
    const makeCat = () => {
      const name = newInput.value.trim();
      if (!name) return newInput.focus();
      if (!site.modelCats) site.modelCats = [];
      const c = { id: uid(), name, models: all.filter((m) => sel.has(m)) };
      site.modelCats.push(c);
      saveCats();
      secOpen.set(`c:${c.id}`, true);
      toast(`已新建「${name}」，${c.models.length} 个模型`, "success");
      newInput.value = "";
      stopSelect();
      mode = "cat";
      input.value = "";
      paint();
    };
    newInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !imeEnter(e)) { e.preventDefault(); makeCat(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); newBox.hidden = true; }
    });
    body.querySelector(".cw-mpick-top").addEventListener("click", async (e) => {
      const v = e.target.closest("[data-view]");
      if (v) {
        if (v.dataset.view === mode) return;
        mode = v.dataset.view;
        if (site && (multi || site.modelView || site.modelCats?.length)) site.modelView = mode;
        else settings().modelView = mode;
        saveSettings();
        return paint();
      }
      const a = e.target.closest("[data-act]")?.dataset.act;
      if (!a) return;
      if (a === "selmode") { if (selecting) stopSelect(); else selecting = true; return paint(); }
      if (a === "selall") { all.filter(hit).forEach((m) => sel.add(m)); return paint(); }
      if (a === "selnone") { if (query()) all.filter(hit).forEach((m) => sel.delete(m)); else sel.clear(); return paint(); }
      if (a === "newok") return makeCat();
      if (a === "newcancel") { newBox.hidden = true; newInput.value = ""; return; }
      if (a === "cancel") { stopSelect(); return paint(); }
      if (a === "save") {
        editing.models = [...editing.models.filter((m) => !allSet.has(m)), ...all.filter((m) => sel.has(m))];
        saveCats();
        toast(`「${editing.name}」已保存，${sel.size} 个模型`, "success");
        stopSelect();
        return paint();
      }
      if (!sel.size) return toast("先勾选模型", "info");
      if (a === "newcat") { newBox.hidden = false; newInput.focus(); return; }
      if (a === "addto") {
        const id = await pickBox("加入哪个分类", cats().map((c) => ({ label: c.name, sub: `${c.models.filter((m) => allSet.has(m)).length} 个模型`, value: c.id })));
        const c = cats().find((x) => x.id === id);
        if (!c) return;
        const before = c.models.length;
        c.models = [...new Set([...c.models, ...all.filter((m) => sel.has(m))])];
        saveCats();
        secOpen.set(`c:${c.id}`, true);
        toast(`已加入「${c.name}」，新增 ${c.models.length - before} 个`, "success");
        stopSelect();
        mode = "cat";
        input.value = "";
        paint();
      }
    });
    box.addEventListener("click", async (e) => {
      const mo = e.target.closest("[data-more]");
      if (mo) { more.has(mo.dataset.more) ? more.delete(mo.dataset.more) : more.add(mo.dataset.more); return paint(); }
      const cm = e.target.closest("[data-catmenu]");
      if (cm) {
        const c = cats().find((x) => x.id === cm.dataset.catmenu);
        if (!c) return;
        const a = await pickBox(`分类「${c.name}」`, [{ label: "编辑模型", sub: "勾选要留下的模型", value: "edit" }, { label: "改名", value: "rename" }, { label: "删除分类", sub: "模型不受影响", value: "del", danger: true }], { anchor: cm });
        if (a === "edit") {
          selecting = true;
          editing = c;
          sel.clear();
          c.models.forEach((m) => allSet.has(m) && sel.add(m));
        } else if (a === "rename") {
          const label = cm.closest(".cw-msec")?.querySelector("b");
          const name = label ? await inlineEdit(label, c.name) : await promptBox("分类改名", c.name);
          if (name) { c.name = name; saveCats(); }
        } else if (a === "del") {
          if (!await confirmBox("删除分类", `删除「${c.name}」？里面的模型不受影响。`, "删除", true)) return;
          site.modelCats = cats().filter((x) => x !== c);
          saveCats();
        }
        return paint();
      }
      const f = e.target.closest("[data-fold]");
      if (f) { secOpen.set(f.dataset.fold, !secOpen.has(f.dataset.fold)); return paint(); }
      const sr = e.target.closest("[data-sel]");
      if (sr) { sel.has(sr.dataset.sel) ? sel.delete(sr.dataset.sel) : sel.add(sr.dataset.sel); return paint(); }
      const b = e.target.closest("[data-m]");
      if (!b) return;
      if (multi) {
        let k = b.dataset.k;
        // 点的是已选中的模型名，保留现在的分组
        if (b.classList.contains("cw-kname") && b.dataset.m === cur && (ownersOf.get(cur) || []).some((x) => x.id === curKey)) k = curKey;
        picked = { model: b.dataset.m, keyId: k };
      } else picked = b.dataset.m;
      w.close(picked);
    });
    // 搜索框回车：只有一个结果时选它，否则用输入的名字
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || imeEnter(e) || selecting) return;
      const first = box.querySelector("[data-m]");
      if (first) { e.preventDefault(); first.click(); }
    });
    box.querySelector(".cw-krow.on, .cw-choice.on")?.scrollIntoView({ block: "center" });
    if (matchMedia("(pointer:fine)").matches) input.focus();
  } });
  return picked;
}
// site：传了就能建分类（分类记在站点上）
function pickModel(list, cur, { title = "选择模型", site = null } = {}) {
  return modelPicker({ site, list, cur, title });
}
// 多密钥站点：选模型时一并选分组。cur：{ keyId, model }，返回 { model, keyId }
function pickKeyModel(site, cur, { title = "选择模型" } = {}) {
  return modelPicker({ site, keys: site.keys, cur: cur?.model || "", curKey: cur?.keyId || null, title });
}
// 模型按钮：key 是多密钥站点当前分组名；arrow 有列表可选时才显示
const modelBtn = (cur, { act = "", attrs = "", arrow = true, key = "" } = {}) =>
  html`<button type="button" class="cw-modelbtn"${act ? raw(` data-act="${esc(act)}"`) : ""}${raw(attrs ? " " + attrs : "")} title="${[cur, key].filter(Boolean).join(" · ")}"><span class="cw-modelbtn-name">${cur || "选择模型"}</span>${key ? html`<em class="cw-pill cw-pill-line">${key}</em>` : ""}${arrow ? iconHtml("chevDown") : ""}</button>`;
