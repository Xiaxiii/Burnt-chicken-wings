// 「缝合」页：从（预设 / 世界书 / 文件 / 粘贴）选条目，到（当前预设 / 世界书）选位置，预览后缝入。
// 宽屏左右两栏（中间可拖动调宽），窄屏「从 / 到」切换。缝合正则、搬到新版在页头。
var repainting = false;
function repaint(node, markup) {
  repainting = true;
  try { if (node.isConnected) node.outerHTML = String(markup); } finally { repainting = false; }
}
// 本次缝后开启：计数、总开关（部分开启时滑块居中）、按来源
function stitchEnableTools() {
  return html`<div class="cw-enable" data-enable-tools role="group" aria-label="本次缝合的开启状态">
    <span data-enable-count aria-live="polite"></span>
    <label class="cw-switch" title="打开全部开启，关闭全部关闭；仍可逐条调整"><input type="checkbox" data-enable-toggle aria-label="本次缝后全部开启"><i></i></label>
    <button type="button" class="cw-link" data-enable-source title="每条恢复成来源里的开关状态">按来源</button></div>
    <p class="cw-hint">默认与来源一致：来源里开着的缝后开启，关着的缝后关闭。</p>`;
}
function bindStitchEnableTools(body, items) {
  const tools = body.querySelector("[data-enable-tools]");
  const toggle = tools.querySelector("[data-enable-toggle]");
  const refresh = () => {
    const count = items.filter((it) => it.enabled).length;
    tools.querySelector("[data-enable-count]").textContent = `${count && count < items.length ? "部分开启" : "缝后开启"}：${count} / ${items.length}`;
    toggle.checked = count === items.length;
    toggle.indeterminate = count > 0 && count < items.length;
  };
  toggle.addEventListener("change", () => {
    const on = toggle.checked;
    for (const it of items) it.enabled = on;
    body.querySelectorAll('.cw-items [data-c="on"]').forEach((input) => { input.checked = on; });
    refresh();
  });
  body.addEventListener("change", (e) => { if (e.target.matches('.cw-items [data-c="on"]')) refresh(); });
  tools.querySelector("[data-enable-source]").addEventListener("click", () => {
    for (const it of items) it.enabled = it.srcEnabled !== false;
    body.querySelectorAll('.cw-items [data-c="on"]').forEach((input) => {
      const it = items[Number(input.closest(".cw-item")?.dataset.i)];
      if (it) input.checked = it.enabled;
    });
    refresh();
  });
  refresh();
}
// 正文缩略：开头两行 + 结尾两行
function stitchSnip(text) {
  const lines = String(text || "").split("\n").filter((l) => l.trim() && !/^\s*(-{3,}|\*{3,}|={3,})\s*$/.test(l));
  const cut = (l) => (l = l.trim(), l.length > 46 ? l.slice(0, 46) + "…" : l);
  return (lines.length <= 5 ? lines.map(cut) : [...lines.slice(0, 2).map(cut), "⋯", ...lines.slice(-2).map(cut)]).join("\n");
}
var SRC_TYPES = [["preset", "预设"], ["world", "世界书"], ["file", "文件"], ["paste", "粘贴"]];
var DST_TYPES = [["preset", "预设"], ["world", "世界书"]];
function mountStitchPage(page) {
  const st = {
    srcType: "preset", srcPreset: null, srcWorld: null,
    fileDraft: null, fileKind: null, fileWorld: null,
    picked: new Map(), // key -> {name, content, prompt, from, srcDraft, srcId, raw}
    fold: new Map(),
    dstFor: null, marker: null, newName: null, pasteN: 0,
    worldCache: new Map(),
    dstType: "preset", dstWorld: null, wbDraft: null, wbMarker: null,
    pane: "src", srcBody: false, dstBody: false, highlight: null, lastWb: null
  };
  page.innerHTML = String(html`
    <header class="cw-pagehead cw-stitch-head"><div class="cw-col cw-col-wide">
      <div class="cw-stitch-heading"><h2>跨预设缝合</h2><p class="cw-stitch-summary">选择要缝入的条目</p></div>
      <div class="cw-stitch-utilities">${btn("正则", { act: "st-regex", icon: "regex", title: "缝合正则" })}
      ${btn("迁移", { act: "st-migrate", icon: "move", title: "搬到新版：来源选旧版、目标选新版，将旧版中缝入的条目按原位置搬到新版" })}</div>
    </div></header>
    <nav class="cw-stitch-flow" aria-label="缝合步骤">
      <button type="button" class="cw-stitch-step" data-st-step="src" data-pane="src"><span class="cw-step-num" aria-hidden="true">1</span><span><b>选择材料</b><small data-step-note="src">未选条目</small></span></button>
      <span class="cw-flow-line" aria-hidden="true"></span>
      <button type="button" class="cw-stitch-step" data-st-step="dst" data-pane="dst"><span class="cw-step-num" aria-hidden="true">2</span><span><b>确定位置</b><small data-step-note="dst">未选位置</small></span></button>
      <span class="cw-flow-line" aria-hidden="true"></span>
      <button type="button" class="cw-stitch-step" data-st-step="review" disabled><span class="cw-step-num" aria-hidden="true">3</span><span><b>预览缝合</b><small data-step-note="review">等待材料与位置</small></span></button>
    </nav>
    <div class="cw-stitch" data-show="src">
      <section class="cw-pane cw-pane-src" aria-label="来源材料" tabindex="-1">
        <div class="cw-pane-head">
          <div class="cw-pane-caption"><h3>来源材料</h3><span>选取要缝入的内容</span></div>
          <div class="cw-pane-row">${segHtml(SRC_TYPES, "preset", { attr: "data-srctype", size: "sm", label: "来源类型" })}</div>
          <div class="cw-pane-row cw-pane-pick-row"><span class="cw-src-pick"></span><label class="cw-search cw-search-sm" data-side="src">${iconHtml("search")}<input type="text" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="搜名称、分组、标签" aria-label="搜索来源条目" data-q="src">${ibtn("close", "清空搜索", { act: "qclear-src", cls: "cw-search-x" })}</label></div>
        </div>
        <div class="cw-body cw-pane-list" data-list="src"></div>
      </section>
      <div class="cw-divider" role="separator" tabindex="0" aria-label="拖动调整两栏宽度" title="拖动调整宽度"><span></span></div>
      <section class="cw-pane cw-pane-dst" aria-label="目标预设或世界书" tabindex="-1">
        <div class="cw-pane-head">
          <div class="cw-pane-caption"><h3>缝合目标</h3><span>点选插入位置</span></div>
          <div class="cw-pane-row">${segHtml(DST_TYPES, "preset", { attr: "data-dsttype", size: "sm", label: "目标类型" })}</div>
          <div class="cw-pane-row cw-pane-pick-row"><span class="cw-dst-pick"></span><label class="cw-search cw-search-sm" data-side="dst">${iconHtml("search")}<input type="text" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="搜名称、分组、标签" aria-label="搜索目标条目" data-q="dst">${ibtn("close", "清空搜索", { act: "qclear-dst", cls: "cw-search-x" })}</label></div>
        </div>
        <div class="cw-body cw-pane-list" data-list="dst"></div>
      </section>
    </div>
    <div class="cw-bar cw-stitchbar"><div class="cw-col cw-col-wide">
      <div class="cw-stitch-tray"><div class="cw-tray-head"><span class="cw-tray-label">材料托盘</span><button type="button" class="cw-link cw-picked-n" data-act="st-picked">未选条目</button></div><div class="cw-tray-items" aria-live="polite"></div></div>
      <div class="cw-stitch-destination"><span class="cw-tray-label">插入位置</span><small class="cw-where">未选位置</small></div>
      <div class="cw-bar-acts">${btn("撤销", { act: "st-wbundo", attrs: "hidden" })}${btn("清空", { act: "st-clear", title: "清空已选的条目和缝合位置" })}${btn("预览缝合", { act: "st-go", kind: "primary", disabled: true })}</div>
    </div></div>
    <div class="cw-bar cw-ngbar" hidden><div class="cw-col cw-col-wide"><div class="cw-bar-info"><b class="cw-ng-n"></b><small>点组名或条目，新分组放在它后面</small></div>${btn("取消", { act: "st-ngcancel" })}</div></div>`);
  const stitchEl = page.querySelector(".cw-stitch");
  const srcList = page.querySelector('[data-list="src"]');
  const dstList = page.querySelector('[data-list="dst"]');
  const bar = page.querySelector(".cw-stitchbar");
  const ngbar = page.querySelector(".cw-ngbar");
  const target = () => getDraft(focusPreset());
  // ---- 宽屏两栏可以拖动调宽，记住比例（sutureSplit，15–85）
  const divider = page.querySelector(".cw-divider");
  const applySplit = (v) => {
    const r = Math.min(85, Math.max(15, Number(v) || 50));
    stitchEl.style.setProperty("--cw-split", r + "fr");
    stitchEl.style.setProperty("--cw-split-r", 100 - r + "fr");
    return r;
  };
  applySplit(settings().sutureSplit ?? 50);
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add("is-dragging");
    const rect = stitchEl.getBoundingClientRect();
    let last = null;
    const move = (ev) => { last = applySplit((ev.clientX - rect.left) / rect.width * 100); };
    const up = () => {
      divider.classList.remove("is-dragging");
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      divider.removeEventListener("pointercancel", up);
      if (last != null) { settings().sutureSplit = Math.round(last); saveSettings(); }
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
    divider.addEventListener("pointercancel", up);
  });
  divider.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: -5, ArrowRight: 5 }[e.key];
    if (!k) return;
    e.preventDefault();
    settings().sutureSplit = applySplit((settings().sutureSplit ?? 50) + k);
    saveSettings();
  });
  // ---- 窄屏：「从 / 到」切换
  function setPane(p) {
    st.pane = p;
    stitchEl.dataset.show = p;
    page.querySelectorAll("[data-pane]").forEach((b) => { if (b.tagName === "BUTTON") { b.classList.toggle("on", b.dataset.pane === p); b.setAttribute("aria-pressed", String(b.dataset.pane === p)); } });
    paintFlow();
  }
  function paintPaneSeg() {
    paintFlow();
  }
  // 流程只呈现已有的材料和插入位置，不单独保存一份进度，避免切来源或目标后状态失真。
  function paintFlow() {
    const n = st.picked.size;
    const placed = !st.newName && !!(st.dstType === "world" ? st.wbMarker : st.marker);
    const ready = n > 0 && placed;
    const current = !n ? "src" : !placed ? "dst" : "review";
    page.querySelectorAll("[data-st-step]").forEach((b) => {
      const step = b.dataset.stStep;
      const done = step === "src" ? n > 0 : step === "dst" ? placed : false;
      b.classList.toggle("is-done", done);
      b.classList.toggle("is-focused", step === st.pane);
      b.classList.toggle("is-ready", step === "review" && ready);
      if (step === current) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
      if (step === "review") b.disabled = !ready;
    });
    page.querySelector('[data-step-note="src"]').textContent = n ? `已选 ${n} 条` : "未选条目";
    page.querySelector('[data-step-note="dst"]').textContent = st.newName ? "为新分组定位置" : placed ? "已选插入位置" : "未选位置";
    page.querySelector('[data-step-note="review"]').textContent = ready ? "检查写法与开关" : !n ? "等待选择材料" : "等待确定位置";
    page.querySelector(".cw-stitch-summary").textContent = ready ? `${n} 条材料已就绪，预览后确认缝合` : !n ? "选择要缝入的条目" : st.newName ? `为新分组「${st.newName}」选择插入位置` : `已选 ${n} 条材料，接着确定插入位置`;
  }
  // ---- 来源
  const regexSource = () => st.srcType === "file" && st.fileKind === "regex";
  const fileName = () => st.fileKind === "world" ? st.fileWorld?.name : st.fileDraft?.name;
  function paintTypeSeg(attr, cur) {
    page.querySelectorAll(`[${attr}]`).forEach((b) => { b.classList.toggle("on", b.getAttribute(attr) === cur); b.setAttribute("aria-selected", String(b.getAttribute(attr) === cur)); });
  }
  function renderSrcPick() {
    paintTypeSeg("data-srctype", st.srcType);
    const slot = page.querySelector(".cw-src-pick");
    page.querySelector('[data-side="src"]').hidden = st.srcType === "paste" || regexSource();
    if (st.srcType === "preset") {
      const names = listPresets();
      if (!st.srcPreset || !names.includes(st.srcPreset)) st.srcPreset = names.find((n) => n !== focusPreset()) || names[0];
      slot.innerHTML = String(html`<button type="button" class="cw-pick-btn" data-act="src-pick" title="${st.srcPreset || ""}"><span>${st.srcPreset || "请选择"}</span>${st.srcPreset === currentPresetName() ? html`<small>使用中</small>` : ""}${iconHtml("chevDown")}</button>`);
    } else if (st.srcType === "world") {
      const names = listWorldbooks();
      if (!st.srcWorld || !names.includes(st.srcWorld)) st.srcWorld = names[0] || null;
      slot.innerHTML = String(names.length ? html`<button type="button" class="cw-pick-btn" data-act="src-pick" title="${st.srcWorld}"><span>${st.srcWorld}</span>${iconHtml("chevDown")}</button>` : html`<span class="cw-hint">没有世界书</span>`);
    } else if (st.srcType === "file") {
      slot.innerHTML = String(fileBtn(fileName() || "选择文件…", { icon: "folder", attr: "data-src-file" }));
    } else slot.innerHTML = String(html`<span class="cw-hint">粘贴一段文字作为条目</span>`);
  }
  // 文件来源认三种：聊天补全预设（prompts）、世界书（entries，含角色卡内嵌的 character_book）、正则（单条、多条或 regex_scripts）
  const isRegexScript = (x) => !!x && typeof x === "object" && typeof x.findRegex === "string";
  function readSourceFile(name, data) {
    if (Array.isArray(data?.prompts) && (data.prompts.length || !data.extensions?.regex_scripts?.length)) return { fileKind: "preset", fileDraft: new Draft(name, data), fileWorld: null };
    const book = data?.entries ?? data?.character_book?.entries ?? data?.data?.character_book?.entries;
    if (book && typeof book === "object") {
      const items = worldItems(`wf:${name}`, Object.values(book));
      if (items.length) return { fileKind: "world", fileDraft: null, fileWorld: { name, items } };
    }
    const scripts = isRegexScript(data) ? [data] : Array.isArray(data) && data.length && data.every(isRegexScript) ? data
      : Array.isArray(data?.regex_scripts) ? data.regex_scripts : Array.isArray(data?.extensions?.regex_scripts) ? data.extensions.regex_scripts : null;
    if (scripts?.length) return { fileKind: "regex", fileDraft: new Draft(name, { prompts: [], extensions: { regex_scripts: scripts } }), fileWorld: null };
    throw new Error("无法识别。支持聊天补全预设、世界书、正则文件");
  }
  function regexSourceDraft() {
    if (st.srcType === "file") return st.fileKind === "world" ? null : st.fileDraft;
    return st.srcType === "preset" && st.srcPreset ? getDraft(st.srcPreset) : null;
  }
  // 分组折叠按「分组名 + 同名第几个」记；记的是展开的组（sutureFold，最多 40 个预设）
  function foldKeys(d) {
    const seen = new Map(), out = new Map();
    for (const g of d.groups.groups) {
      const n = seen.get(g.name) || 0;
      seen.set(g.name, n + 1);
      out.set(g.id, `${g.name}\u0001${n}`);
    }
    return out;
  }
  const collapsedFrom = (d, open) => {
    const keys = foldKeys(d);
    return new Set(d.groups.groups.filter((g) => !open.has(keys.get(g.id))).map((g) => g.id));
  };
  function foldStore() {
    const s = settings();
    if (!s.sutureFold || typeof s.sutureFold !== "object" || Array.isArray(s.sutureFold)) s.sutureFold = {};
    return s.sutureFold;
  }
  function openSetFor(key) {
    if (!st.fold.has(key)) st.fold.set(key, new Set(Array.isArray(foldStore()[key]) ? foldStore()[key] : []));
    return st.fold.get(key);
  }
  function toggleOpen(d, key, gid, on) {
    const k = foldKeys(d).get(gid);
    if (!k) return;
    const open = openSetFor(key);
    if (on ?? !open.has(k)) open.add(k);
    else open.delete(k);
    const store = foldStore();
    delete store[key];
    if (open.size) store[key] = [...open];
    const keys = Object.keys(store);
    for (const x of keys.slice(0, Math.max(0, keys.length - 40))) delete store[x];
    saveSettings();
  }
  // ---- 搜索：两侧各一个输入框，词存进设置（sutureQuery），关掉面板后仍按它筛
  const qStore = () => {
    if (!settings().sutureQuery || typeof settings().sutureQuery !== "object") settings().sutureQuery = {};
    return settings().sutureQuery;
  };
  const qKey = (side) => side === "src" ? (st.srcType === "world" ? "qSrcWb" : "qSrc") : (st.dstType === "world" ? "qDstWb" : "qDst");
  const qOf = (side) => String(qStore()[qKey(side)] || "").trim();
  function paintQ(side) {
    const input = page.querySelector(`[data-q="${side}"]`);
    if (document.activeElement !== input) input.value = qOf(side);
    input.closest(".cw-search").classList.toggle("has-q", !!input.value);
  }
  function setQuery(side, v) {
    qStore()[qKey(side)] = v;
    if (!v) st[side === "src" ? "srcBody" : "dstBody"] = false;
    side === "src" ? renderSrc() : renderDst();
  }
  for (const side of ["src", "dst"]) {
    const input = page.querySelector(`[data-q="${side}"]`);
    onSearchInput(input, () => { setQuery(side, input.value.trim()); input.closest(".cw-search").classList.toggle("has-q", !!input.value); });
    input.addEventListener("change", () => saveSettings());
  }
  // 世界书条目列表（酒馆里的世界书和世界书文件共用）
  function renderWorldRows(items, from) {
    srcList.dataset.kind = "world";
    srcList._items = items;
    srcList._from = from;
    const wq = qOf("src").toLowerCase();
    const shown = wq ? items.filter((it) => String(it.name).toLowerCase().includes(wq) || String(it.content || "").toLowerCase().includes(wq)) : items;
    srcList.innerHTML = String(html`<div class="cw-col">${wq ? html`<div class="cw-qsum">匹配 <b>${shown.length}</b> 条（名称或正文）</div>` : ""}<div class="cw-list">${shown.length ? shown.map((it) => html`<div class="cw-row${st.picked.has(it.id) ? " is-sel" : ""}${it.enabled ? "" : " is-off"}" data-wid="${it.id}" tabindex="0" data-key-click><span class="cw-row-sel" aria-hidden="true"></span><span class="cw-row-main"><span class="cw-row-name">${raw(markText(it.name, wq))}</span></span>${ibtn("edit", "查看或编辑", { act: "edit", cls: "cw-row-edit" })}</div>`) : empty(wq ? "没有匹配的条目" : "没有条目")}</div></div>`);
  }
  async function renderSrc() {
    paintQ("src");
    if (regexSource()) return renderRegexSrc();
    const keyOf = (id) => `${st.srcType}:${st.srcType === "preset" ? st.srcPreset : st.srcType === "file" ? st.fileDraft?.name : ""}:${id}`;
    if (st.srcType === "preset" || st.srcType === "file" && st.fileKind !== "world") {
      let d;
      try {
        d = st.srcType === "preset" ? st.srcPreset ? getDraft(st.srcPreset) : null : st.fileDraft;
      } catch (e) {
        srcList.innerHTML = `<div class="cw-col">${empty(e.message)}</div>`;
        return;
      }
      if (!d) {
        srcList.innerHTML = `<div class="cw-col">${empty(st.srcType === "file" ? "选择一个预设、世界书或正则文件" : "没有预设")}</div>`;
        return renderBar();
      }
      st.srcFoldKey = `src:${st.srcType}:${d.name}`;
      st.srcCollapsed = collapsedFrom(d, openSetFor(st.srcFoldKey));
      const sel = new Set(d.order.map((o) => o.identifier).filter((id) => st.picked.has(keyOf(id))));
      srcList.innerHTML = `<div class="cw-col"><div class="cw-list">${renderEntryList(d, { mode: "source", selected: sel, collapsed: st.srcCollapsed, query: qOf("src"), searchBody: st.srcBody })}</div></div>`;
      srcList.dataset.kind = "draft";
      srcList._draft = d;
      srcList._keyOf = keyOf;
    } else if (st.srcType === "file" && st.fileKind === "world") {
      renderWorldRows(st.fileWorld.items, `世界书文件 ${st.fileWorld.name}`);
    } else if (st.srcType === "world") {
      if (!st.srcWorld) {
        srcList.innerHTML = `<div class="cw-col">${empty("没有世界书")}</div>`;
        return renderBar();
      }
      // 记下发请求时选的是哪本：网慢时用户可能已经换了别的书
      const wname = st.srcWorld;
      let items = st.worldCache.get(wname);
      if (!items) {
        srcList.innerHTML = `<div class="cw-col">${empty("读取中…")}</div>`;
        try {
          items = await readWorldbook(wname);
          st.worldCache.set(wname, items);
        } catch (e) {
          if (st.srcType === "world" && st.srcWorld === wname) srcList.innerHTML = `<div class="cw-col">${empty("读取失败：" + e.message)}</div>`;
          return;
        }
        if (st.srcType !== "world" || st.srcWorld !== wname) return;
      }
      renderWorldRows(items, `世界书 ${wname}`);
    } else {
      srcList.dataset.kind = "paste";
      const pasted = [...st.picked.entries()].filter(([k]) => k.startsWith("paste:"));
      srcList.innerHTML = String(html`<div class="cw-col"><div class="cw-form cw-paste">
          <label class="cw-field"><span>条目名称</span><input class="cw-input" data-p="name" placeholder="不填则叫「粘贴条目 N」"></label>
          <label class="cw-field"><span>条目正文</span><textarea class="cw-input" data-p="content" placeholder="变量写法会按目标预设自动调整"></textarea></label>
          <div>${btn("加入", { act: "paste-add", icon: "plus" })}</div>
          ${pasted.length ? html`<p class="cw-hint">已加入：${pasted.map(([, v]) => v.name).join("、")}</p>` : ""}</div></div>`);
    }
    renderBar();
  }
  function renderRegexSrc() {
    let d = null, n = 0;
    try {
      d = regexSourceDraft();
      n = d ? presetRegexList(d).length : 0;
    } catch (e) {
      srcList.innerHTML = `<div class="cw-col">${empty(e.message)}</div>`;
      return;
    }
    srcList.dataset.kind = "regex";
    let to = "";
    try { to = st.dstType === "preset" ? target().name : ""; } catch {}
    srcList.innerHTML = String(html`<div class="cw-col"><div class="cw-card"><b>「${d.name}」中有 ${n} 条正则</b>
      <p class="cw-hint">${n ? to ? `缝入目标预设「${to}」，可逐条选择。` : "正则只能缝入预设，请将目标切换为「预设」。" : "文件中没有正则。"}</p>
      ${n && to ? html`<div class="cw-card-acts">${btn("选择正则…", { act: "st-regex", kind: "primary" })}</div>` : ""}</div></div>`);
    renderBar();
  }
  // 「查看」可以直接改：已安装预设存回预设（可撤销），文件只改读入的内容，世界书写回世界书（写前备份）。已选的条目跟着更新
  function syncPicked(test, patch, rawPatch) {
    for (const v of st.picked.values()) {
      if (!test(v)) continue;
      Object.assign(v, patch);
      if (v.raw && rawPatch) Object.assign(v.raw, rawPatch);
    }
  }
  async function editPresetEntry(d, id) {
    const p = d.prompt(id);
    if (!p) return;
    const file = d === st.fileDraft;
    const r = await editEntrySheet(p, { marker: d.isMarker(id), title: p.name || "编辑条目", hint: file ? "只改这次读入的文件内容，不会写回文件。" : `保存后写入预设「${d.name}」，可撤销。` });
    if (!r) return;
    let dd = d;
    if (!file) {
      try { dd = getDraft(d.name); } catch (e) { return toast(e.message, "error"); }
    }
    const cur = dd.prompt(id);
    if (!cur) return toast("条目已不存在，未保存", "warning");
    const next = entryChanges(cur, r);
    if (!next) return;
    if (file) Object.assign(cur, next);
    else mutate(dd, "编辑条目", (x) => Object.assign(x.prompt(id), next));
    syncPicked((v) => v.srcId === id && v.from === dd.name, { name: cur.name, content: cur.content, prompt: cur, srcDraft: dd });
    renderSrc();
    toast("已保存", "success");
  }
  async function editFileWorldEntry(it) {
    const r = await editEntrySheet({ name: it.name, content: it.content }, { promptOnly: true, title: it.name, hint: "只改这次读入的文件内容，不会写回文件。" });
    if (!r || r.name === it.name && r.content === it.content) return;
    Object.assign(it, { name: r.name, content: r.content });
    Object.assign(it.raw, { comment: r.name, content: r.content });
    const v = st.picked.get(it.id);
    if (v) Object.assign(v, { name: r.name, content: r.content });
    renderSrc();
    toast("已保存", "success");
  }
  async function editWorldEntry(wname, uidv, name, content) {
    const r = await editEntrySheet({ name, content }, { promptOnly: true, title: name, hint: `保存后写入世界书「${wname}」。` });
    if (!r || r.name === name && r.content === content) return;
    const fields = { content: r.content };
    if (r.name !== name) fields.comment = r.name;
    try {
      await backupPut(`世界书：${wname}`, await mods.wi.loadWorldInfo(wname), "编辑前");
    } catch (e) {
      if (!await confirmBox("备份失败", `编辑前备份世界书「${wname}」没有成功（${e.message}）。仍要保存吗？`, "仍要保存")) return;
    }
    try {
      await updateWorldEntry(wname, uidv, fields);
    } catch (e) {
      return toast("保存失败：" + e.message, "error");
    }
    syncPicked((v) => v.raw && String(v.raw.uid) === String(uidv) && v.from === `世界书 ${wname}`, { name: r.name, content: r.content }, fields);
    st.worldCache.delete(wname);
    toast("已保存", "success");
    if (st.srcType === "world" && st.srcWorld === wname) renderSrc();
    if (st.dstType === "world" && st.dstWorld === wname) {
      try { await loadWbDraft(true); } catch {}
      renderDst();
    }
  }
  srcList.addEventListener("click", async (e) => {
    if (e.target.closest('[data-act="qbody"]')) { st.srcBody = !st.srcBody; return renderSrc(); }
    const kind = srcList.dataset.kind;
    if (kind === "paste") {
      if (e.target.closest('[data-act="paste-add"]')) {
        const name = srcList.querySelector("[data-p=name]").value.trim() || `粘贴条目 ${st.pasteN + 1}`;
        const content = srcList.querySelector("[data-p=content]").value;
        if (!content.trim()) return toast("正文为空");
        st.picked.set(`paste:${++st.pasteN}`, { name, content, prompt: null, from: "粘贴" });
        renderSrc();
      }
      return;
    }
    if (kind === "regex") return;
    const editBtn = e.target.closest('[data-act="edit"]');
    if (kind === "world") {
      const r = e.target.closest("[data-wid]");
      if (!r) return;
      const it = srcList._items.find((x) => x.id === r.dataset.wid);
      if (editBtn) return st.srcType === "file" ? editFileWorldEntry(it) : editWorldEntry(st.srcWorld, it.uid, it.name, it.content);
      st.picked.has(it.id) ? st.picked.delete(it.id) : st.picked.set(it.id, { name: it.name, content: it.content, prompt: null, from: srcList._from, raw: it.raw });
      return renderSrc();
    }
    const d = srcList._draft;
    if (!d) return;
    const head = e.target.closest(".cw-ghead");
    if (head) {
      const gid = head.dataset.gid;
      if (e.target.closest('[data-act="gselect"]')) {
        const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier).filter((x) => !d.isMarker(x));
        const all = ids.every((x) => st.picked.has(srcList._keyOf(x)));
        for (const x of ids) {
          const k2 = srcList._keyOf(x);
          if (all) st.picked.delete(k2);
          else {
            const p2 = d.prompt(x);
            st.picked.set(k2, { name: p2.name, content: p2.content, prompt: p2, from: d.name, srcDraft: d, srcId: x });
          }
        }
      } else toggleOpen(d, st.srcFoldKey, gid);
      return renderSrc();
    }
    const row = e.target.closest(".cw-row");
    if (!row) return;
    const id = row.dataset.id;
    const p = d.prompt(id);
    if (editBtn) return editPresetEntry(d, id);
    if (d.isMarker(id)) return toast("系统位置条目不能缝合");
    const k = srcList._keyOf(id);
    st.picked.has(k) ? st.picked.delete(k) : st.picked.set(k, { name: p.name, content: p.content, prompt: p, from: d.name, srcDraft: d, srcId: id });
    renderSrc();
  });
  // ---- 目标
  // 世界书目标：把条目包装成一个只读的「预设」，列表、选位置都沿用预设那一套（没有分组）
  async function loadWbDraft(force = false) {
    const names = listWorldbooks();
    if (!st.dstWorld || !names.includes(st.dstWorld)) st.dstWorld = names[0] || null;
    if (!st.dstWorld) { st.wbDraft = null; return; }
    if (!force && st.wbDraft?.name === st.dstWorld) return;
    const wname = st.dstWorld;
    const data = await mods.wi.loadWorldInfo(wname);
    if (st.dstWorld !== wname) return;
    const list = wiSorted(data);
    const prompts = list.map((e) => ({ identifier: `wb${e.uid}`, name: e.comment || (e.key || []).join(",") || `条目${e.uid}`, content: e.content || "", role: "system", system_prompt: false, marker: false, injection_position: 0 }));
    const dd = new Draft(wname, { prompts, prompt_order: [{ character_id: 100001, order: list.map((e) => ({ identifier: `wb${e.uid}`, enabled: !e.disable })) }] });
    dd.wb = Object.fromEntries(list.map((e) => [`wb${e.uid}`, e]));
    if (st.wbDraft?.name !== wname) st.wbMarker = null;
    st.wbDraft = dd;
    st.wbMarker = fixPlace(dd, st.wbMarker);
  }
  function renderDstPick() {
    paintTypeSeg("data-dsttype", st.dstType);
    const slot = page.querySelector(".cw-dst-pick");
    if (st.dstType === "world") {
      slot.innerHTML = String(st.dstWorld || listWorldbooks().length ? html`<button type="button" class="cw-pick-btn" data-act="dst-pick" title="${st.dstWorld || ""}"><span>${st.dstWorld || "请选择"}</span>${iconHtml("chevDown")}</button>` : html`<span class="cw-hint">没有世界书</span>`);
    } else {
      const name = focusPreset();
      slot.innerHTML = String(html`<button type="button" class="cw-pick-btn" data-act="dst-pick" title="${name}"><span>${name}</span>${name === currentPresetName() ? html`<small>使用中</small>` : ""}${iconHtml("chevDown")}</button>`);
    }
  }
  async function renderDstWorld() {
    try {
      await loadWbDraft();
    } catch (e) {
      dstList.innerHTML = `<div class="cw-col">${empty("读取失败：" + e.message)}</div>`;
      return;
    }
    renderDstPick();
    const d = st.wbDraft;
    if (!d) {
      dstList.innerHTML = `<div class="cw-col">${empty("没有世界书")}</div>`;
      return renderBar();
    }
    const top = dstList.scrollTop;
    dstList.innerHTML = `<div class="cw-col"><div class="cw-list is-placing">${renderEntryList(d, { mode: "target", place: true, inside: false, collapsed: new Set(), marker: st.wbMarker, markLabel: "缝合位置", highlight: st.highlight || void 0, query: qOf("dst"), searchBody: st.dstBody })}</div></div>`;
    bar.hidden = false;
    ngbar.hidden = true;
    dstList.scrollTop = top;
    renderBar();
  }
  function renderDst() {
    paintQ("dst");
    if (st.dstType === "world") return renderDstWorld();
    renderDstPick();
    let d;
    try {
      d = target();
    } catch (e) {
      dstList.innerHTML = `<div class="cw-col">${empty(e.message)}</div>`;
      return;
    }
    if (st.dstFor !== d.name) {
      st.dstFor = d.name;
      st.marker = null;
    }
    // 位置指向的条目/分组已经不在了就清掉
    st.marker = fixPlace(d, st.marker);
    st.dstFoldKey = `dst:${d.name}`;
    st.dstCollapsed = collapsedFrom(d, openSetFor(st.dstFoldKey));
    const top = dstList.scrollTop;
    dstList.innerHTML = String(html`<div class="cw-col">${st.newName || qOf("dst") ? "" : html`<button type="button" class="cw-slot cw-slot-new" data-act="st-newgroup">${iconHtml("plus")}<span>新建分组…</span></button>`}<div class="cw-list is-placing">${raw(renderEntryList(d, { mode: "target", place: true, inside: !st.newName, collapsed: st.dstCollapsed, marker: st.newName ? null : st.marker, markLabel: "缝合位置", highlight: st.highlight || void 0, query: qOf("dst"), searchBody: st.dstBody }))}</div></div>`);
    bar.hidden = !!st.newName;
    ngbar.hidden = !st.newName;
    ngbar.querySelector(".cw-ng-n").textContent = st.newName ? `新分组「${st.newName}」放在哪里` : "";
    dstList.scrollTop = top;
    renderBar();
  }
  dstList.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="qbody"]')) { st.dstBody = !st.dstBody; return renderDst(); }
    if (e.target.closest('[data-act="st-newgroup"]')) return;
    if (st.dstType === "world") {
      const d2 = st.wbDraft;
      if (!d2) return;
      if (e.target.closest('[data-act="edit"]')) {
        const id = e.target.closest(".cw-row").dataset.id;
        const p = d2.prompt(id);
        return editWorldEntry(d2.name, d2.wb[id].uid, p.name, p.content);
      }
      const m2 = placeFromClick(d2, e, false);
      if (!m2) return;
      st.wbMarker = m2;
      return renderDst();
    }
    const d = target();
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "edit") return editPresetEntry(d, e.target.closest(".cw-row").dataset.id);
    const head = e.target.closest(".cw-ghead");
    // 点组名＝放在这组后面，点箭头才展开、收起
    if (head && act === "fold" && e.target.closest(".cw-ico")) {
      toggleOpen(d, st.dstFoldKey, head.dataset.gid);
      return renderDst();
    }
    const m = placeFromClick(d, e, !st.newName);
    if (!m) return;
    if (st.newName) {
      // 新建空白分组：放好以后，缝合位置就定在这个新组里
      const p = placeOf(d, m);
      let gid = null;
      mutate(d, `新建分组「${st.newName}」`, (x) => { gid = x.createEmptyGroup(st.newName, p.where.index === 0 ? "" : p.where.after); });
      toast(`已新建分组「${st.newName}」`, "success");
      st.newName = null;
      toggleOpen(d, st.dstFoldKey, gid, true);
      st.marker = { at: "gstart", gid };
      renderDst();
      dstList.querySelector(`.cw-group[data-gid="${CSS.escape(gid)}"]`)?.scrollIntoView({ block: "center" });
      return;
    }
    st.marker = m;
    renderDst();
  });
  function renderBar() {
    const n = st.picked.size;
    let d = null;
    try { d = st.dstType === "world" ? st.wbDraft : target(); } catch {}
    const m = st.dstType === "world" ? st.wbMarker : st.marker;
    const pn = bar.querySelector(".cw-picked-n");
    pn.textContent = n ? `已选 ${n} 条` : "未选条目";
    pn.disabled = !n;
    const picks = [...st.picked.values()];
    bar.querySelector(".cw-tray-items").innerHTML = String(n ? html`${picks.slice(0, 3).map((it) => html`<button type="button" class="cw-tray-chip" data-act="st-picked" title="${it.name || "（无名）"}，查看已选材料">${it.name || "（无名）"}</button>`)}${n > 3 ? html`<button type="button" class="cw-tray-more" data-act="st-picked">另 ${n - 3} 条</button>` : ""}` : html`<span class="cw-tray-empty">从来源中选取条目，材料会汇集到这里</span>`);
    bar.querySelector(".cw-where").textContent = d && m ? `${st.dstType === "world" ? `世界书「${d.name}」，` : ""}${placeText(d, m)}` : st.dstType === "world" ? "在目标里点条目选位置" : "在目标里点组名或条目选位置";
    bar.querySelector('[data-act="st-go"]').disabled = !(n && m);
    bar.querySelector('[data-act="st-clear"]').disabled = !(n || m);
    const undo = bar.querySelector('[data-act="st-wbundo"]');
    undo.hidden = !(st.dstType === "world" && st.lastWb && st.lastWb.name === st.dstWorld);
    if (!undo.hidden) undo.querySelector("span").textContent = `撤销刚缝的 ${st.lastWb.uids.length} 条`;
    paintPaneSeg();
  }
  async function regexSuture() {
    if (st.dstType !== "preset") return toast("正则只能缝入预设，请将目标切换为「预设」");
    try {
      let source = regexSourceDraft();
      if (!source) {
        const v = await pickName({ title: "缝合哪个预设的正则", current: st.srcPreset, items: listPresets().map((n) => ({ value: n, sub: n === focusPreset() ? "目标" : "" })) });
        if (!v) return;
        source = getDraft(v);
      }
      if (source === target()) return toast("来源和目标是同一个预设，请先在「从」里选另一个预设");
      await presetRegexDialog(source, target());
      if (regexSource()) renderSrc();
    } catch (err) { toast("正则缝合失败：" + err.message, "error"); }
  }
  page.addEventListener("change", async (e) => {
    if (!e.target.matches("input[data-src-file]")) return;
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = "";
    try {
      const data = JSON.parse((await f.text()).replace(/^﻿/, ""));
      const got = readSourceFile(f.name.replace(/\.json$/i, ""), data);
      Object.assign(st, got);
      renderSrcPick();
      renderSrc();
      if (st.fileKind === "regex") regexSuture();
    } catch (err) {
      toast("无法读取文件：" + err.message, "error");
    }
  });
  bindFileKeys(page);
  page.addEventListener("click", async (e) => {
    const step = e.target.closest("[data-st-step]");
    if (step) {
      if (step.disabled) return;
      if (step.dataset.stStep === "review") return st.dstType === "world" ? reviewWorld() : review();
      setPane(step.dataset.stStep);
      page.querySelector(step.dataset.stStep === "src" ? ".cw-pane-src" : ".cw-pane-dst").focus({ preventScroll: true });
      return;
    }
    const typeBtn = e.target.closest("[data-srctype], [data-dsttype], [data-pane]");
    if (typeBtn && typeBtn.tagName === "BUTTON") {
      if (typeBtn.dataset.pane) return setPane(typeBtn.dataset.pane);
      if (typeBtn.dataset.srctype && typeBtn.dataset.srctype !== st.srcType) {
        st.srcType = typeBtn.dataset.srctype;
        renderSrcPick();
        return renderSrc();
      }
      if (typeBtn.dataset.dsttype && typeBtn.dataset.dsttype !== st.dstType) {
        st.dstType = typeBtn.dataset.dsttype;
        st.newName = null;
        renderSrcPick();
        return renderDst();
      }
      return;
    }
    const a = e.target.closest("[data-act]")?.dataset.act;
    if (!a) return;
    if (a === "qclear-src" || a === "qclear-dst") {
      const side = a.slice(7);
      page.querySelector(`[data-q="${side}"]`).value = "";
      setQuery(side, "");
      saveSettings();
      return;
    }
    if (a === "src-pick") {
      if (st.srcType === "preset") {
        const using = currentPresetName();
        const v = await pickName({ title: "从哪个预设", current: st.srcPreset, items: listPresets().map((n) => ({ value: n, sub: n === using ? "使用中" : n === focusPreset() ? "目标" : "" })) });
        if (!v || v === st.srcPreset) return;
        st.srcPreset = v;
      } else if (st.srcType === "world") {
        const v = await pickName({ title: "从哪本世界书", current: st.srcWorld, items: listWorldbooks().map((n) => ({ value: n })) });
        if (!v) return;
        st.srcWorld = v;
        st.worldCache.delete(v); // 每次选择都重新读，酒馆里改过的内容才能看到
      }
      renderSrcPick();
      return renderSrc();
    }
    if (a === "dst-pick") {
      if (st.dstType === "world") {
        const v = await pickName({ title: "到哪本世界书", current: st.dstWorld, items: listWorldbooks().map((n) => ({ value: n })) });
        if (!v || v === st.dstWorld) return;
        st.dstWorld = v;
        st.wbMarker = null;
        return renderDst();
      }
      await pickScope();
      return;
    }
    if (a === "st-clear") {
      st.picked.clear();
      st.marker = null;
      st.wbMarker = null;
      renderSrc();
      return renderDst();
    }
    if (a === "st-go") return st.dstType === "world" ? reviewWorld() : review();
    if (a === "st-regex") return regexSuture();
    if (a === "st-migrate") {
      if (st.srcType !== "preset" || st.dstType !== "preset") return toast("请把「从」和「到」都切到预设：从选旧版，到选新版");
      return migrate();
    }
    if (a === "st-picked") return pickedSheet();
    if (a === "st-wbundo") return undoWorld();
    if (a === "st-newgroup") {
      const n = await promptBox("新分组名称", "", "例如：文风", { hint: "起名后，点组名或条目，新分组放在它后面；缝合位置随即定在新分组里。" });
      if (!n) return;
      st.newName = n;
      return renderDst();
    }
    if (a === "st-ngcancel") {
      st.newName = null;
      return renderDst();
    }
  });
  // 已选条目清单：跨预设、世界书、粘贴选的都在这里，可以单独去掉
  async function pickedSheet() {
    if (!st.picked.size) return;
    const body = el('<div class="cw-picked"></div>');
    const paint = () => {
      const rows = [...st.picked.entries()];
      body.innerHTML = String(rows.length ? html`${rows.map(([k, v]) => html`<div class="cw-picked-row"><span><b>${v.name || "（无名）"}</b><small>${v.from || ""}</small></span>${btn("去掉", { size: "sm", attrs: `data-k="${esc(k)}"` })}</div>`)}` : html`<p class="cw-hint">没有已选的条目</p>`);
    };
    paint();
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]");
      if (!b) return;
      st.picked.delete(b.dataset.k);
      paint();
      renderSrc();
    });
    await dialog({ title: "已选的条目", body, actions: [{ label: "完成", kind: "primary", value: true }] });
    renderSrc();
  }
  // 这条材料所在的来源分组是不是整组都选了（系统位置条目不算）
  function wholeGroupOf(src) {
    const sd = src.srcDraft;
    if (!sd || !src.srcId) return null;
    const g = sd.groupOf(src.srcId);
    if (!g) return null;
    const picked = new Set([...st.picked.values()].filter((v) => v.srcDraft?.name === sd.name).map((v) => v.srcId));
    const mem = sd.order.map((o) => o.identifier).filter((x) => sd.groupOf(x) === g && !sd.isMarker(x));
    return mem.length && mem.every((x) => picked.has(x)) ? { key: `${sd.name}|${g}`, name: sd.group(g)?.name || "分组" } : null;
  }
  // ---- 缝合预览（目标是预设）。spec（搬到新版用）：{ entries: [{ src, marker, hook, enabled }] }，每条可以有自己的位置
  async function review(spec = null) {
    const d = target();
    let entries;
    if (spec) entries = spec.entries.map((e) => ({ ...e, marker: fixPlace(d, e.marker) || { at: "top" } }));
    else {
      const marker = fixPlace(d, st.marker);
      if (!marker) return renderDst();
      entries = [...st.picked.values()].map((src) => ({ src, marker }));
    }
    if (!entries.length) return;
    const tgtProf = profilePreset(d);
    const posCache = new Map();
    const posOf = (marker) => {
      const k = JSON.stringify(marker);
      if (!posCache.has(k)) {
        const pw = placeOf(d, marker);
        posCache.set(k, { key: k, marker, where: pw.where, gid: pw.gid, t: inferTarget(d, pw.where, pw.gid), tgtWr: wrappersAt(d, tgtProf, insertionIndex(d, pw.where)) });
      }
      return posCache.get(k);
    };
    const srcProfs = new Map();
    const items = entries.map(({ src, marker, hook, enabled }) => {
      let desc = null;
      if (src.srcDraft && src.srcId) {
        try {
          if (!srcProfs.has(src.srcDraft)) srcProfs.set(src.srcDraft, profilePreset(src.srcDraft));
          desc = describeEntry(src.srcDraft, src.srcId, srcProfs.get(src.srcDraft));
        } catch (e) {
          console.warn("[焦香鸡翅] 来源分析失败", e);
        }
      }
      // 缝后开关默认与来源条目一致（看条目自身开关，不看分组总开关）
      const from = enabled ?? (src.srcDraft && src.srcId ? src.srcDraft.order.find((o) => o.identifier === src.srcId)?.enabled !== false : true);
      return { src: { ...src, sections: desc?.inside || [] }, desc, choice: hook ? { hook: true } : {}, autoHook: !!spec && !hook, manual: null, enabled: from, srcEnabled: from, srcGroup: spec ? null : wholeGroupOf(src), pos: posOf(marker) };
    });
    // 缝来的格式条目要靠来源预设的显示正则美化；目标没有对应正则时提醒，缝完可一起缝正则
    const regexDeps = new Map();
    for (const it of items) {
      const sd = it.src.srcDraft;
      if (!sd || sd === d) continue;
      it.regexDeps = presetRegexFormatDeps(sd, d, [it.src.content])[0];
      if (!it.regexDeps.length) continue;
      if (!regexDeps.has(sd)) regexDeps.set(sd, new Set());
      it.regexDeps.forEach((x) => regexDeps.get(sd).add(x.index));
    }
    const single = posCache.size === 1;
    const P0 = items[0].pos;
    const { gid, t } = P0;
    const marker = P0.marker;
    const tgtWr = P0.tgtWr;
    // 整组选中的来源分组：成员排在一起（在第一次出现的位置），缝到组外时可以保持成组
    const groupKeys = [];
    for (const it of items) if (it.srcGroup && !groupKeys.some((g) => g.key === it.srcGroup.key)) groupKeys.push(it.srcGroup);
    items.splice(0, items.length, ...items.reduce((acc, it) => {
      if (!it.srcGroup) acc.push(it);
      else if (!acc.some((x) => x.srcGroup?.key === it.srcGroup.key)) acc.push(...items.filter((x) => x.srcGroup?.key === it.srcGroup.key));
      return acc;
    }, []));
    const grpDefault = groupKeys.length ? "keep" : "none";
    const grpRow = gid || !single || spec ? "" : html`<div class="cw-form-row">
        <label class="cw-field"><span>分组</span><select class="cw-select" data-g="grp">
          ${groupKeys.length ? html`<option value="keep">保留原分组（${groupKeys.map((g) => g.name).join("、")}）</option>` : ""}
          <option value="none"${grpDefault === "none" ? raw(" selected") : ""}>不分组</option>
          <option value="new">放入新分组</option></select></label>
        <label class="cw-field" data-g="gnamebox" hidden><span>新分组名称</span><input class="cw-input" data-g="gname" placeholder="新分组名称"></label></div>`;
    const fromLabel = (it) => {
      const f = String(it.src.from || "").replace(/^世界书\s*/, "");
      return f && f !== "粘贴" ? f : "";
    };
    const nameOf = (it) => it.customName ?? (settings().nameWithSource && fromLabel(it) ? `${it.src.name}（来自${fromLabel(it)}）` : it.src.name);
    const body = el(html`<div class="cw-review">
        <div class="cw-card cw-review-head">
          ${single ? html`<div class="cw-review-where"><b>位置：${placeText(d, marker)}</b><small>附近条目的写法：${t.summary}${tgtWr.length ? `。位于 <${tgtWr.join("> / <")}> 之内` : ""}</small></div>${grpRow}` : html`<div class="cw-review-where"><b>缝到 ${posCache.size} 个位置</b><small>按各条目在来源中的位置，分别放在目标中对应条目之后。每条的位置见条目详情。</small></div>`}
          ${stitchEnableTools()}
          <div class="cw-hookbar"><span class="cw-hookbar-n"></span><span class="cw-gap"></span>${btn("全部接入", { size: "sm", attrs: 'data-g="hook-all"' })}${btn("推荐接入", { size: "sm", attrs: 'data-g="hook-rec"' })}${btn("全部不接入", { size: "sm", attrs: 'data-g="hook-none"' })}</div>
          <p class="cw-hint">接入思维链：让模型思考时专门想一下这条。每接入一条，思考就多一个问题，默认不接入。</p>
          ${fold("更多选项和两边写法的分析", String(html`
            <label class="cw-check"><input type="checkbox" data-g="inj"${settings().followTargetInjection ? raw(" checked") : ""}><span>按目标写法缝合时，角色和插入位置与目标一致</span></label>
            <label class="cw-check"><input type="checkbox" data-g="from"${settings().nameWithSource ? raw(" checked") : ""}><span>条目名称后加「（来自来源预设）」</span></label>
            ${tgtProf.lines.length ? html`<h4>目标预设怎样让条目生效</h4><ul class="cw-bullets">${tgtProf.lines.map((l) => html`<li>${l}</li>`)}</ul>` : ""}
            ${[...srcProfs].map(([sd, pr]) => pr.lines.length ? html`<h4>来源「${sd.name}」怎样让条目生效</h4><ul class="cw-bullets">${pr.lines.map((l) => html`<li>${l}</li>`)}</ul>` : "")}`))}
        </div>
        <div class="cw-items"></div>
      </div>`);
    const box = body.querySelector(".cw-items");
    const initName = (() => {
      const id = findInitEntry(d);
      return id ? d.prompt(id)?.name : null;
    })();
    const hookBlock = (it) => {
      const h = it.hook;
      if (h.status !== "hook") return html`<div class="cw-hook is-${h.status}"><small><b>思维链：</b>${h.text}</small></div>`;
      const cotName = d.prompt(h.cotId)?.name || "";
      const more = (h.cotIds || []).length > 1 ? `（共 ${h.cotIds.length} 个思维链版本）` : "";
      let detail = "";
      if (it.hookOn && h.mode === "text") {
        detail = html`<label class="cw-field"><span>在「${cotName}」中添加一行${more}</span><input class="cw-input" data-c="hq" value="${h.question}"></label>
            <small class="cw-dim">${h.needle ? `添加在提到 ${h.needle} 的一行之后` : "添加在思维链末尾"}。条目正文不变。</small>`;
      } else if (it.hookOn && (h.mode === "append" || h.mode === "slot")) {
        detail = html`<label class="cw-field"><span>${h.mode === "slot" ? "登记的问句" : "追加的内容"}</span><input class="cw-input" data-c="hq" value="${h.question}"></label>
            <small class="cw-dim">条目末尾添加 {{${h.mode === "slot" ? "setvar" : "addvar"}::${h.varName}::…}}。「${cotName}」已读取「${h.varName}」，思维链不变。</small>`;
      } else if (it.hookOn) {
        detail = html`<div class="cw-form-row"><label class="cw-field"><span>问句变量</span><input class="cw-input" data-c="hv" value="${h.varName}"></label>
            <label class="cw-field"><span>思维链中的问句</span><input class="cw-input" data-c="hq" value="${h.question}"></label></div>
            ${h.clash ? html`<p class="cw-warn-text">目标中已有变量「${h.varName}」，同名会互相覆盖，请更换名称</p>` : ""}
            <small class="cw-dim">条目末尾添加 {{setvar::${h.varName}::…}}；${initName ? `「${initName}」中添加一行清空` : "未找到初始化条目，不添加清空"}；「${cotName}」${more}中${h.anchorVar ? `在 {{getvar::${h.anchorVar}}} 之后` : ""}添加 {{getvar::${h.varName}}}。</small>`;
      }
      return html`<div class="cw-hook">
            <label class="cw-check"><input type="checkbox" data-c="hook"${it.hookOn ? raw(" checked") : ""}><span><b>接入思维链</b>${h.on ? pill("推荐", "accent") : ""}<small>${h.text}${it.hookOn || h.on ? "" : "。" + (h.offHint || "")}</small></span></label>
            ${(h.warns || []).map((w) => html`<p class="cw-warn-text">${w}</p>`)}${detail}</div>`;
    };
    const renderItem = (it, i, analysis = null) => {
      const { t: tt, where, gid: g2, tgtWr: wr } = it.pos;
      const src = { ...it.src, name: it.src.name };
      const base = { ...it.choice };
      delete base.shape;
      const planFix = planItem(src, tt, base);
      const planSlot = tt.slot && !planFix.slotAllowed ? planItem(src, tt, { ...base, shape: tt.slot.shape }) : null;
      const rawContent = String(it.src.content || "");
      const same = planFix.content.trim() === rawContent.trim();
      let mode = it.choice.mode || (same ? "raw" : "fix");
      if (mode === "slot" && !planSlot) mode = "fix";
      it.mode = mode;
      const chosen = mode === "raw" ? { content: rawContent, label: planFix.label, want: { shape: "plain" }, slotAllowed: false } : mode === "slot" ? planSlot : planFix;
      it.plan = chosen;
      const taken = new Set(items.filter((o) => o !== it && o.hookOn && o.hook?.varName).map((o) => o.hook.varName));
      const srcCot = it.desc?.cot ? ["var", "chain", "mention"].includes(it.desc.cot.level) : null;
      const collectors = chosen.want?.shape === "wrap" && chosen.want.varName === tt.varName ? tt.readerIds.filter((r) => !isCotEntry(d, r)) : [];
      try {
        it.hook = planHook(d, where, g2, { content: chosen.content, name: it.src.name, label: planFix.label }, { taken, varName: it.choice.hookVar || void 0, question: it.choice.hookQ ?? void 0, srcCot, allowSlot: mode === "slot" || planFix.slotAllowed, collector: collectors.length ? d.prompt(collectors[0])?.name : null, analysis });
      } catch (e) {
        console.warn("[焦香鸡翅] 思维链检查失败", e);
        it.hook = { status: "skip", on: false, text: "思维链检查出错，已跳过" };
      }
      // 搬到新版：没有缝合记录的条目，原预设的思维链读取过它就默认接入
      if (it.autoHook && it.choice.hook === void 0) it.choice.hook = !!it.hook.on;
      it.hookOn = it.hook.status === "hook" && !!it.choice.hook;
      it.finalContent = it.hookOn ? contentWithHook(chosen.content, it.hook) : chosen.content;
      const warns = [];
      const sp = it.src.prompt;
      if (sp?.injection_position === 1) warns.push(`来源中此条目插入聊天记录（深度 ${sp.injection_depth ?? 4}）。原样缝合时保留；按目标写法缝合时${settings().followTargetInjection ? "改为普通位置" : "同样保留"}`);
      if ((sp?.injection_trigger || []).length) warns.push("来源中此条目只在特定生成类型下发送，此设置一并保留");
      const rw = it.src.raw;
      if (rw && !rw.constant && (rw.key || []).length) warns.push(`在世界书中按关键词触发（${rw.key.slice(0, 4).join("、")}${rw.key.length > 4 ? "等" : ""}），缝进预设后会一直生效`);
      if (hasScript(it.src.content || "")) warns.push("含脚本（如 EJS），需要安装相应插件才能生效");
      if (hasConditional(it.src.content || "")) warns.push("含 {{if}} 条件，条件中的变量需在目标中存在");
      for (const dep of it.regexDeps || []) warns.push(`这条要求输出 ${dep.mark}，来源预设靠正则「${dep.name}」显示成美化，目标预设没有对应正则，缝入后只显示原文。确认缝合后可一起缝入`);
      for (const k of it.desc?.needsVars || []) {
        const nm2 = k.replace(/^全局:/, "");
        const has = d.preset.prompts.some((p) => listVarMacros(p.content || "").some((m) => m.name === nm2 && (m.op === "set" || m.op === "add") && !isBlankValue(m.value)));
        if (!has) warns.push(`读取变量「${nm2}」，目标中没有条目写入此变量，该部分将为空`);
      }
      for (const w of it.desc?.inside || []) {
        const tw = tgtProf.wrappers.find((x) => x.name === w);
        if (!tw || wr.includes(w)) continue;
        warns.push(`来源中此条目位于 ${tw.label} 之内。目标的 ${tw.label} 在「${d.prompt(tw.openId)?.name}」与「${d.prompt(tw.closeId)?.name}」之间，当前位置不在其中`);
      }
      const card = (value, title, sub, content, notes = []) => html`<label class="cw-mode${mode === value ? " on" : ""}">
            <span class="cw-mode-head"><input type="radio" name="cw-mode-${i}" data-c="mode" value="${value}"${mode === value ? raw(" checked") : ""}><b>${title}</b><small>${sub}</small></span>
            <pre class="cw-snip">${stitchSnip(content)}</pre>
            ${notes.length && mode === value ? html`<ul class="cw-bullets">${notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}</label>`;
      const modes = same && !planSlot ? card("raw", "原样缝合", "两边写法相同，无需调整", rawContent) : html`
        ${card("raw", "原样缝合", "不调整写法", rawContent)}
        ${card("fix", "按目标写法缝合", `按「${d.name}」的写法调整`, planFix.content, [...(planFix.changes.length ? planFix.changes : ["正文不变，位置和角色与目标一致"]), ...planFix.warnings.map((w) => "注意：" + w)])}
        ${planSlot ? card("slot", `按目标写法缝合，并加入多选一「${tt.slot.varName}」`, "开启后，同类中已开启的一条会被替换", planSlot.content, planSlot.changes) : ""}`;
      const showAdv = mode !== "raw" && (/[{]{2}/.test(chosen.content) || tt.headerTpl || tt.tagTpl || tt.ownTag);
      const modeLabel = { raw: "原样", fix: "按目标写法", slot: "加入多选一" }[mode];
      const hookLabel = it.hook.status !== "hook" ? "" : it.hookOn ? pill("接入思维链", "accent") : it.hook.on ? pill("推荐接入", "line") : "";
      return html`<article class="cw-item${it.open ? " open" : ""}" data-i="${i}">
          <header class="cw-item-head" data-c="toggle"><span class="cw-item-name">${nameOf(it)}</span>
            <span class="cw-item-meta"><label class="cw-check cw-item-on" title="缝进去以后是开着还是关着。不想缝这一条，请回到来源里取消选择"><input type="checkbox" data-c="on"${it.enabled ? raw(" checked") : ""}><span>缝后开启</span></label>${pill(modeLabel, "muted")}${hookLabel}${warns.length ? pill(`提醒 ${warns.length}`, "warn") : ""}</span>
            ${iconHtml("chev")}</header>
          <div class="cw-item-body"${it.open ? "" : raw(" hidden")}>
            <label class="cw-field"><span>条目名称</span><input class="cw-input" data-c="name" value="${nameOf(it)}"></label>
            ${single ? "" : html`<small class="cw-dim">位置：${placeText(d, it.pos.marker)}</small>`}
            ${it.desc ? fold(`在「${it.src.from || ""}」中的作用`, String(html`<ul class="cw-bullets">${it.desc.lines.map((l) => html`<li>${l}</li>`)}${it.desc.cot ? html`<li>${it.desc.cot.text}</li>` : ""}</ul>`)) : html`<small class="cw-dim">来自 ${it.src.from || ""}</small>`}
            <div class="cw-modes" role="radiogroup">${modes}</div>
            ${warns.length ? html`<ul class="cw-bullets cw-warns">${warns.map((w) => html`<li class="cw-warn-text">${w}</li>`)}</ul>` : ""}
            ${hookBlock(it)}
            ${showAdv ? html`<details class="cw-fold cw-adv"${it.choice.adv ? raw(" open") : ""}><summary>${iconHtml("chev")}<span>高级</span></summary><div class="cw-fold-body cw-form-row">
                <label class="cw-field"><span>标题或标签中的名称</span><input class="cw-input" data-c="label" value="${planFix.label}"></label>
                ${chosen.want?.varName && (chosen.want.shape === "wrap" || chosen.want.shape === "tagname") ? html`<label class="cw-field"><span>变量</span><input class="cw-input" data-c="var" value="${chosen.want.varName}"></label>
                <label class="cw-field"><span>写入方式</span><select class="cw-select" data-c="op"><option value="add"${chosen.want.op !== "set" ? raw(" selected") : ""}>可叠加（开启几条就拼几条，addvar）</option><option value="set"${chosen.want.op === "set" ? raw(" selected") : ""}>多选一（只有最后一条开着的生效，setvar）</option></select></label>` : ""}
                ${planFix.sourceShape.extras?.length ? html`<label class="cw-check"><input type="checkbox" data-c="extras"${it.choice.keepExtras ? raw(" checked") : ""}><span>保留来源中的 ${planFix.sourceShape.extras.length} 个附加宏</span></label>` : ""}
              </div></details>` : ""}
            <details class="cw-fold cw-body-edit"${it.bodyOpen ? raw(" open") : ""}><summary>${iconHtml("chev")}<span>缝合后的完整正文${it.manual != null ? "（已手动修改）" : ""}</span></summary><div class="cw-fold-body">
              <textarea class="cw-input" data-c="content" spellcheck="false">${it.manual ?? it.finalContent}</textarea>
              ${it.manual != null ? html`<button type="button" class="cw-link" data-c="reset">撤销手动修改，按上方选项重新生成</button>` : ""}</div></details>
          </div></article>`;
    };
    const rerender = (art, it) => {
      const i = Number(art.dataset.i);
      it.bodyOpen = art.querySelector(".cw-body-edit")?.open || void 0;
      it.choice.adv = art.querySelector(".cw-adv")?.open || void 0;
      repaint(art, d.withReadIndex(() => renderItem(it, i)));
    };
    const renderItems = (analysis = null) => d.withReadIndex(() => {
      const current = analysis || analyze(d);
      return items.map((it, i) => String(renderItem(it, i, current))).join("");
    });
    box.innerHTML = renderItems(tgtProf.a);
    const hookable = () => items.filter((it) => it.hook?.status === "hook");
    // 缝后关着的条目不推荐接入：思维链会去想一条没开的内容
    const recommended = () => hookable().filter((it) => it.hook.on && it.enabled);
    const paintHookBar = () => {
      const hb = body.querySelector(".cw-hookbar");
      const n = hookable().length, rec = recommended().length;
      hb.hidden = !n;
      hb.nextElementSibling.hidden = !n;
      hb.querySelector('[data-g="hook-rec"] span').textContent = `推荐接入（${rec}）`;
      hb.querySelector(".cw-hookbar-n").textContent = `思维链：已接入 ${items.filter((it) => it.hookOn).length} / ${n}`;
      let warn = body.querySelector(".cw-hookbar-warn");
      if (!warn) { warn = document.createElement("p"); warn.className = "cw-warn-text cw-hookbar-warn"; hb.after(warn); }
      warn.hidden = rec <= 10;
      warn.textContent = rec > 10 ? `推荐的 ${rec} 条在来源中已被思维链读取。全部接入将增加 ${rec} 个思考问题，思考变长、易爆思维链。整套缝合时，只接入需重点落实的几条。` : "";
    };
    paintHookBar();
    body.querySelector(".cw-hookbar").addEventListener("click", (e) => {
      const g = e.target.closest("[data-g]")?.dataset.g;
      if (!g) return;
      for (const it of hookable()) {
        it.choice.hook = g === "hook-all" ? true : g === "hook-rec" ? !!it.hook.on && it.enabled : false;
        it.manual = null;
      }
      box.innerHTML = renderItems();
      paintHookBar();
    });
    bindStitchEnableTools(body, items);
    body.addEventListener("change", (e) => { if (e.target.matches('[data-enable-toggle], .cw-items [data-c="on"]')) paintHookBar(); });
    body.querySelector("[data-enable-source]")?.addEventListener("click", () => paintHookBar());
    const grpSel = body.querySelector('[data-g="grp"]');
    const grpName = body.querySelector('[data-g="gname"]');
    grpSel?.addEventListener("change", () => {
      body.querySelector('[data-g="gnamebox"]').hidden = grpSel.value !== "new";
      if (grpSel.value === "new") grpName.focus();
    });
    body.querySelector('[data-g="from"]').addEventListener("change", (e) => {
      settings().nameWithSource = e.target.checked;
      saveSettings();
      box.querySelectorAll(".cw-item").forEach((art) => {
        const it = items[Number(art.dataset.i)];
        if (it.customName != null) return;
        const inp = art.querySelector('[data-c="name"]');
        if (inp) inp.value = nameOf(it);
        art.querySelector(".cw-item-name").textContent = nameOf(it);
      });
    });
    box.addEventListener("change", (e) => {
      const art = e.target.closest(".cw-item");
      // 重画时，正在编辑的输入框被移走会再触发一次 change（失焦），忽略这一次
      if (!art || !art.isConnected || repainting) return;
      const it = items[Number(art.dataset.i)];
      const c2 = e.target.dataset.c;
      if (c2 === "on") return void (it.enabled = e.target.checked);
      if (c2 === "name") {
        it.customName = e.target.value;
        art.querySelector(".cw-item-name").textContent = e.target.value;
        return;
      }
      if (c2 === "content") return void (it.manual = e.target.value);
      if (c2 === "mode") it.choice.mode = e.target.value;
      if (c2 === "var") it.choice.varName = e.target.value.trim();
      if (c2 === "op") it.choice.op = e.target.value;
      if (c2 === "label") it.choice.label = e.target.value;
      if (c2 === "extras") it.choice.keepExtras = e.target.checked;
      if (c2 === "hook") it.choice.hook = e.target.checked;
      if (c2 === "hv") it.choice.hookVar = e.target.value.replace(/[{}:：\s]/g, "");
      if (c2 === "hq") it.choice.hookQ = e.target.value.trim() || void 0;
      it.manual = null;
      rerender(art, it);
      paintHookBar();
    });
    box.addEventListener("click", (e) => {
      const head = e.target.closest('[data-c="toggle"]');
      if (head && !e.target.closest("input, .cw-item-on")) {
        const art = head.closest(".cw-item");
        const it = items[Number(art.dataset.i)];
        it.open = !it.open;
        return rerender(art, it);
      }
      if (e.target.dataset.c !== "reset") return;
      const art = e.target.closest(".cw-item");
      const it = items[Number(art.dataset.i)];
      it.manual = null;
      rerender(art, it);
      paintHookBar();
    });
    const ok = await dialog({ title: spec?.title || `缝合 ${items.length} 条到「${d.name}」`, body, size: "full", noFocus: true, actions: [{ label: "取消", value: null }, {
      label: "确认缝合", kind: "primary",
      validate: () => {
        if (grpSel?.value === "new" && !grpName.value.trim()) {
          grpName.focus();
          toast("请填写新分组名称");
          return false;
        }
        return true;
      },
      value: (w) => ({ inj: w.querySelector('[data-g="inj"]').checked, grp: grpSel?.value || "none", gname: grpName?.value.trim() || "" })
    }] });
    if (!ok) return;
    settings().followTargetInjection = ok.inj;
    saveSettings();
    let newIds = [];
    const inits = [], hooked = [];
    const hookedIdx = new Set();
    mutate(d, spec ? "搬到新版" : `缝合 ${items.length} 条`, (x) => {
      const build = (it) => {
        const t2 = it.pos.t;
        const content = it.manual ?? it.finalContent ?? it.plan.content;
        const prompt = buildPrompt(x, it.src, { content }, t2, { keepSourceInjection: it.mode === "raw" || !ok.inj });
        prompt.name = nameOf(it);
        const v = it.plan.want;
        if ((v.shape === "wrap" || v.shape === "tagname") && v.varName && v.varName !== t2.varName) {
          const initId = t2.initId || findInitEntry(x);
          if (initId && ensureInit(x, v.varName, initId)) inits.push(v.varName);
        }
        return { prompt, enabled: it.enabled };
      };
      // 同一位置的条目一起插入，保持原来的先后顺序
      const byPos = new Map();
      items.forEach((it, i) => (byPos.get(it.pos.key) || byPos.set(it.pos.key, []).get(it.pos.key)).push(i));
      newIds = new Array(items.length);
      for (const [k, idxs] of byPos) {
        const P = posCache.get(k);
        const ids = x.insertPrompts(idxs.map((i) => build(items[i])), P.where, P.gid);
        idxs.forEach((i, j) => { newIds[i] = ids[j]; });
      }
      if (!gid && ok.grp === "new") x.createGroup(ok.gname, newIds);
      if (!gid && ok.grp === "keep") {
        for (const g of groupKeys) {
          const mem = newIds.filter((_, i) => items[i].srcGroup?.key === g.key);
          if (mem.length) x.createGroup(g.name, mem);
        }
      }
      // 挂进思维链：同一个位置挂好几条时，按缝合顺序一条接一条往下排
      const chain = new Map();
      items.forEach((it, i) => {
        if (!it.hookOn || it.hook?.status !== "hook") return;
        const h = { ...it.hook };
        const content = x.prompt(newIds[i])?.content || "";
        if (h.mode !== "text" && !content.includes(`var::${h.varName}::`)) return; // 手动改正文时删掉了问句，就不挂
        if (h.mode === "text") h.line = h.prefix + String(h.question || "").replace(/\n+/g, " ");
        const key = `${h.cotId}|${h.mode === "text" ? h.needle || "" : h.anchorVar || ""}`;
        if (chain.has(key)) {
          if (h.mode === "text") h.needle = chain.get(key);
          else h.anchorVar = chain.get(key);
        }
        const r = applyHook(x, h);
        if (r.ok) {
          chain.set(key, h.mode === "text" ? h.line.trim() : h.varName);
          hooked.push(`${nameOf(it)} → ${r.cotName}`);
          hookedIdx.add(i);
        }
      });
      // 记下哪些条目是缝进来的（是否接入思维链），预设更新后「搬到新版」靠它找回；不记来源名
      const ext = x.preset.extensions || (x.preset.extensions = {});
      const rec = ext.presetAtelier && typeof ext.presetAtelier === "object" ? ext.presetAtelier : (ext.presetAtelier = {});
      const live = new Set(x.order.map((o) => o.identifier));
      rec.stitched = (Array.isArray(rec.stitched) ? rec.stitched : []).filter((r) => live.has(r.id));
      items.forEach((it, i) => rec.stitched.push({ id: newIds[i], at: Date.now(), ...(hookedIdx.has(i) ? { cot: 1 } : {}) }));
      for (const r of rec.stitched) delete r.from;
    });
    if (!spec) st.picked.clear();
    // 下次接着往后缝：落在新分组里就放在这组后面，否则接在最后一条后面
    const lastNew = newIds[newIds.length - 1];
    st.marker = !gid && d.groupOf(lastNew) ? fixPlace(d, { at: "block", id: lastNew }) : { at: "row", id: lastNew };
    toast(`已缝合 ${newIds.length} 条${hooked.length ? `，${hooked.length} 条接入思维链` : ""}${inits.length ? `，初始化条目已添加变量 ${inits.join("、")}` : ""}`, "success");
    for (const [sd, set] of regexDeps) {
      const names = [...set].map((i) => presetRegexList(sd)[i]?.scriptName || "未命名正则");
      const go = await dialog({ size: "sm", title: "一起缝显示正则？", body: html`<p class="cw-p">刚缝入的条目要求特定输出格式，来源「${sd.name}」用正则「${names.join("」「")}」将其显示为美化。目标预设缺少对应正则，不缝入则聊天中只显示原文。</p><p class="cw-hint">下一步打开正则缝合，已预选这几条。</p>`, actions: [{ label: "以后再说", value: false }, { label: "去缝正则", kind: "primary", value: true }] });
      if (go) {
        try { await presetRegexDialog(sd, d, { preselect: [...set] }); } catch (err) { toast("正则缝合失败：" + err.message, "error"); }
      }
    }
    if (gid) toggleOpen(d, `dst:${d.name}`, gid, true);
    st.highlight = new Set(newIds);
    setPane("dst");
    renderSrc();
    renderDst();
    dstList.querySelector(".cw-flash")?.scrollIntoView({ block: "center" });
    setTimeout(() => { st.highlight = null; }, 1500);
  }
  // ---- 缝进世界书：没有思维链和分组；每条可设触发方式、插入位置、深度、顺序
  async function reviewWorld() {
    try {
      await loadWbDraft(true);
    } catch (e) {
      return toast("读取世界书失败：" + e.message, "error");
    }
    const d = st.wbDraft;
    const marker = d && fixPlace(d, st.wbMarker);
    if (!marker) return renderDst();
    const { where } = placeOf(d, marker);
    const t = inferTarget(d, where, null);
    const afterId = marker.at === "top" ? null : marker.id;
    const firstId = d.order[0]?.identifier;
    const anchor = d.wb[afterId || firstId] || null;
    const roleNum = (r) => ({ system: 0, user: 1, assistant: 2 })[r] ?? 0;
    const base = { position: anchor?.position ?? 0, depth: anchor?.depth ?? 4, role: anchor?.role ?? 0, order: anchor?.order ?? 100 };
    // 预设和本世界书里写入过的变量（读取没人写的变量时提醒）
    const written = new Set();
    const addW = (txt) => listVarMacros(txt || "").forEach((m) => { if ((m.op === "set" || m.op === "add") && !isBlankValue(m.value)) written.add(m.name); });
    Object.values(d.wb).forEach((e) => addW(e.content));
    try { getDraft(focusPreset()).preset.prompts.forEach((x) => addW(x.content)); } catch {}
    const items = [...st.picked.values()].map((src) => {
      const rw = src.raw;
      const sp = src.prompt;
      const wb = rw ? { constant: !!rw.constant, keys: (rw.key || []).join(", "), position: rw.position ?? 0, depth: rw.depth ?? 4, role: rw.role ?? 0, order: rw.order ?? 100, from: true }
        : { constant: true, keys: "", ...base, ...(sp?.injection_position === 1 ? { position: 4, depth: sp.injection_depth ?? 4, role: roleNum(sp.role) } : {}) };
      const from = rw ? !rw.disable : src.srcDraft && src.srcId ? src.srcDraft.order.find((o) => o.identifier === src.srcId)?.enabled !== false : true;
      return { src: { ...src, sections: [] }, wb, choice: {}, manual: null, enabled: from, srcEnabled: from, open: false };
    });
    const posName = (v) => WI_POS.find(([k]) => k === Number(v))?.[1] || "角色定义之前";
    const renderItem = (it, i) => {
      const rawText = String(it.src.content || "");
      const plan = planItem({ ...it.src }, t, it.choice);
      const same = plan.content.trim() === rawText.trim();
      const mode = same ? "raw" : it.choice.mode || "fix";
      it.content = mode === "raw" ? rawText : plan.content;
      const warns = [];
      for (const m of listVarMacros(it.content)) if (m.op === "get" && !written.has(m.name)) warns.push(`读取变量「${m.name}」，世界书和当前预设中都没有条目写入此变量，该部分将为空`);
      if (hasScript(rawText)) warns.push("含脚本（如 EJS），需要安装相应插件才能生效");
      if (hasConditional(rawText)) warns.push("含 {{if}} 条件，条件中的变量需存在");
      if (!it.wb.constant && !it.wb.keys.trim()) warns.push("按关键词触发但没有填写关键词，条目不会生效");
      const card = (value, title, sub, content) => html`<label class="cw-mode${mode === value ? " on" : ""}">
            <span class="cw-mode-head"><input type="radio" name="cw-wmode-${i}" data-c="mode" value="${value}"${mode === value ? raw(" checked") : ""}><b>${title}</b><small>${sub}</small></span>
            <pre class="cw-snip">${stitchSnip(content)}</pre>${mode === value && value === "fix" && plan.changes.length ? html`<ul class="cw-bullets">${plan.changes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}</label>`;
      const w = it.wb;
      return html`<article class="cw-item${it.open ? " open" : ""}" data-i="${i}">
        <header class="cw-item-head" data-c="toggle"><span class="cw-item-name">${it.name ?? it.src.name}</span>
          <span class="cw-item-meta"><label class="cw-check cw-item-on" title="缝进去以后是开着还是关着。不想缝这一条，请回到来源里取消选择"><input type="checkbox" data-c="on"${it.enabled ? raw(" checked") : ""}><span>缝后开启</span></label>${pill(w.constant ? "常驻" : "关键词", "muted")}${pill(`${posName(w.position)}${Number(w.position) === 4 ? ` ${w.depth}` : ""}`, "muted")}${warns.length ? pill(`提醒 ${warns.length}`, "warn") : ""}</span>${iconHtml("chev")}</header>
        <div class="cw-item-body"${it.open ? "" : raw(" hidden")}>
          <label class="cw-field"><span>条目名称</span><input class="cw-input" data-c="name" value="${it.name ?? it.src.name}"></label>
          <small class="cw-dim">来自 ${it.src.from || ""}${w.from ? "，沿用原世界书中的触发和插入设置" : ""}</small>
          <div class="cw-modes" role="radiogroup">${same ? card("raw", "原样缝合", "两边写法相同，无需调整", rawText) : html`${card("raw", "原样缝合", "不调整写法", rawText)}${card("fix", "按目标写法缝合", `按「${d.name}」的写法调整`, plan.content)}`}</div>
          ${warns.length ? html`<ul class="cw-bullets cw-warns">${warns.map((x) => html`<li class="cw-warn-text">${x}</li>`)}</ul>` : ""}
          <div class="cw-form-row">
            <label class="cw-field"><span>触发</span><select class="cw-select" data-c="constant"><option value="1"${w.constant ? raw(" selected") : ""}>常驻（一直生效）</option><option value="0"${w.constant ? "" : raw(" selected")}>按关键词触发</option></select></label>
            ${w.constant ? "" : html`<label class="cw-field"><span>关键词（逗号分隔）</span><input class="cw-input" data-c="keys" value="${w.keys}"></label>`}
            <label class="cw-field"><span>插入位置</span><select class="cw-select" data-c="position">${WI_POS.map(([k, l]) => html`<option value="${k}"${Number(w.position) === k ? raw(" selected") : ""}>${l}</option>`)}</select></label>
            ${Number(w.position) === 4 ? html`<label class="cw-field"><span>深度</span><input class="cw-input" type="number" min="0" data-c="depth" value="${w.depth}"></label>
            <label class="cw-field"><span>角色</span><select class="cw-select" data-c="role">${[[0, "系统"], [1, "用户"], [2, "AI"]].map(([k, l]) => html`<option value="${k}"${Number(w.role) === k ? raw(" selected") : ""}>${l}</option>`)}</select></label>` : ""}
            <label class="cw-field"><span>顺序</span><input class="cw-input" type="number" data-c="order" value="${w.order}"></label>
          </div>
          <details class="cw-fold cw-body-edit"${it.bodyOpen ? raw(" open") : ""}><summary>${iconHtml("chev")}<span>缝合后的完整正文${it.manual != null ? "（已手动修改）" : ""}</span></summary><div class="cw-fold-body">
            <textarea class="cw-input" data-c="content" spellcheck="false">${it.manual ?? it.content}</textarea></div></details>
        </div></article>`;
    };
    const body = el(html`<div class="cw-review">
        <div class="cw-card cw-review-head"><div class="cw-review-where"><b>位置：世界书「${d.name}」，${placeText(d, marker)}</b>
          <small>位置决定条目在世界书编辑器中的排列。实际发送顺序由每条的「插入位置」和「顺序」决定，默认与${anchor ? `「${d.prompt(afterId || firstId)?.name || ""}」` : "世界书默认值"}相同。预设条目缝入后默认「常驻」，与在预设中一样一直生效。</small></div>${stitchEnableTools()}</div>
        <div class="cw-items"></div></div>`);
    const box = body.querySelector(".cw-items");
    box.innerHTML = items.map((it, i) => String(renderItem(it, i))).join("");
    bindStitchEnableTools(body, items);
    box.addEventListener("change", (e) => {
      const art = e.target.closest(".cw-item");
      if (!art || !art.isConnected || repainting) return;
      const it = items[Number(art.dataset.i)];
      const c2 = e.target.dataset.c, v = e.target.value;
      if (c2 === "on") return void (it.enabled = e.target.checked);
      if (c2 === "name") return void (it.name = v, art.querySelector(".cw-item-name").textContent = v);
      if (c2 === "content") return void (it.manual = v);
      if (c2 === "keys") it.wb.keys = v;
      if (c2 === "mode") { it.choice.mode = v; it.manual = null; }
      if (c2 === "constant") it.wb.constant = v === "1";
      if (c2 === "position") it.wb.position = Number(v);
      if (c2 === "depth") it.wb.depth = Math.max(0, Number(v) || 0);
      if (c2 === "role") it.wb.role = Number(v);
      if (c2 === "order") it.wb.order = Number(v) || 0;
      it.bodyOpen = art.querySelector(".cw-body-edit")?.open || void 0;
      repaint(art, renderItem(it, Number(art.dataset.i)));
    });
    box.addEventListener("click", (e) => {
      const head = e.target.closest('[data-c="toggle"]');
      if (!head || e.target.closest("input, .cw-item-on")) return;
      const art = head.closest(".cw-item");
      const it = items[Number(art.dataset.i)];
      it.open = !it.open;
      repaint(art, renderItem(it, Number(art.dataset.i)));
    });
    const ok = await dialog({ title: `缝合 ${items.length} 条到世界书「${d.name}」`, body, size: "full", noFocus: true, actions: [{ label: "取消", value: null }, { label: "确认缝合", kind: "primary", value: true }] });
    if (!ok) return;
    const fields = items.map((it) => {
      const w = it.wb;
      const rw = it.src.raw ? structuredClone(it.src.raw) : {};
      delete rw.uid;
      delete rw.displayIndex;
      return { ...rw, comment: it.name ?? it.src.name, content: it.manual ?? it.content, constant: w.constant, key: w.constant && !w.keys.trim() ? rw.key || [] : w.keys.split(/[,，]/).map((x) => x.trim()).filter(Boolean), position: w.position, depth: w.depth, role: w.role, order: w.order, disable: !it.enabled };
    });
    // 写之前备份整本世界书（存在本浏览器，「备份」页可见）
    try {
      await backupPut(`世界书：${d.name}`, await mods.wi.loadWorldInfo(d.name), "缝合前");
    } catch (e) {
      if (!await confirmBox("备份失败", `缝合前备份世界书「${d.name}」没有成功（${e.message}）。仍可在缝合后用底栏的「撤销」删掉刚缝进去的条目。继续缝合吗？`, "继续缝合")) return;
    }
    try {
      const uids = await writeWorldEntries(d.name, fields, afterId ? d.wb[afterId]?.uid : null);
      st.lastWb = { name: d.name, uids };
      st.worldCache.delete(d.name);
      st.picked.clear();
      await loadWbDraft(true);
      st.wbMarker = { at: "row", id: `wb${uids[uids.length - 1]}` };
      st.highlight = new Set(uids.map((u) => `wb${u}`));
      toast(`已缝合 ${uids.length} 条到世界书「${d.name}」`, "success");
      setPane("dst");
      renderSrc();
      await renderDst();
      dstList.querySelector(".cw-flash")?.scrollIntoView({ block: "center" });
      setTimeout(() => { st.highlight = null; }, 1500);
    } catch (e) {
      toast("写入世界书失败：" + e.message, "error");
    }
  }
  // 世界书不在撤销记录里：单独记下刚缝进去的条目，可以删回去
  async function undoWorld() {
    const last = st.lastWb;
    if (!last) return;
    if (!await confirmBox("撤销缝合", `从世界书「${last.name}」删掉刚缝进去的 ${last.uids.length} 条？`, "删除", true)) return;
    try {
      const data = await mods.wi.loadWorldInfo(last.name);
      const gone = new Set(last.uids.map(String));
      for (const k of Object.keys(data.entries || {})) if (gone.has(String(data.entries[k].uid))) delete data.entries[k];
      wiSorted(data).forEach((e, i) => { e.displayIndex = i; });
      await mods.wi.saveWorldInfo(last.name, data, true);
      try { mods.wi.reloadEditor?.(last.name); } catch {}
      st.lastWb = null;
      st.worldCache.delete(last.name);
      st.wbMarker = null;
      await loadWbDraft(true);
      toast("已撤销", "success");
      renderDst();
    } catch (e) {
      toast("撤销失败：" + e.message, "error");
    }
  }
  // ---- 搬到新版：从＝旧版，到＝新版。把旧版里缝进去的条目按原位置搬过去
  async function migrate() {
    if (st.srcType !== "preset" || !st.srcPreset) return;
    const neu = target();
    if (st.srcPreset === neu.name) return toast("来源和目标是同一个预设。请在「从」里选旧版，「到」是新版");
    const old = getDraft(st.srcPreset);
    const rec = new Map((old.preset.extensions?.presetAtelier?.stitched || []).map((r) => [r.id, r]));
    const norm = (x) => String(x || "").replace(/\s+/g, "");
    const newIds = new Set(neu.order.map((o) => o.identifier));
    const newContent = new Set(neu.preset.prompts.map((p) => norm(p.content)).filter(Boolean));
    const newByName = new Map(neu.preset.prompts.map((p) => [p.name, p.identifier]));
    const order = old.order.map((o) => o.identifier);
    const inNew = (id) => newIds.has(id) && !rec.has(id) ? id : (() => {
      const nm = old.prompt(id)?.name;
      const hit = nm && newByName.get(nm);
      return hit && !rec.has(id) ? hit : null;
    })();
    const cands = [];
    order.forEach((id, i) => {
      if (old.isMarker(id)) return;
      const p = old.prompt(id);
      if (!p) return;
      const recorded = rec.has(id);
      if (newContent.has(norm(p.content)) && norm(p.content)) return;
      if (!recorded && (newIds.has(id) || newByName.has(p.name))) return;
      // 位置：往前找最近一个新版里也有的条目，放在它后面
      let anchor = null;
      for (let j = i - 1; j >= 0 && !anchor; j--) anchor = inNew(order[j]);
      const og = old.groupOf(id), ag = anchor ? neu.groupOf(anchor) : null;
      const sameGroup = og && anchor && old.group(og)?.name === neu.group(ag)?.name;
      const marker = !anchor ? { at: "top" } : ag && !sameGroup ? { at: "block", id: anchor } : { at: "row", id: anchor };
      cands.push({ id, p, recorded, marker, on: recorded, hook: !!rec.get(id)?.cot });
    });
    if (!cands.length) return toast(`「${old.name}」中没有找到需要搬到「${neu.name}」的条目`);
    const body = el(html`<div class="cw-form">
      <p class="cw-p">从「${old.name}」搬到「${neu.name}」。有缝合记录的条目已勾选；没有记录、但新版中没有的条目未勾选，可能是后来添加的，也可能是作者在新版中删除的，需自行核对。</p>
      <div class="cw-checklist">${cands.map((c, i) => html`<label class="cw-check cw-checkrow"><input type="checkbox" data-i="${i}"${c.on ? raw(" checked") : ""}><span><b>${c.p.name || c.id}</b><span class="cw-tags">${c.recorded ? pill("缝合记录", "accent") : pill("新版中没有", "muted")}${c.hook ? pill("原先接入思维链", "line") : ""}${pill(placeText(neu, fixPlace(neu, c.marker) || { at: "top" }), "line")}</span></span></label>`)}</div>
      <p class="cw-hint">下一步打开缝合预览，可逐条检查写法和思维链。早于 1.6.0 缝合的条目没有记录，只能按「新版中没有」找出。</p></div>`);
    body.addEventListener("change", (e) => {
      const i = e.target.dataset.i;
      if (i != null) cands[Number(i)].on = e.target.checked;
    });
    const ok = await dialog({ title: `搬到新版：找到 ${cands.length} 条`, body, size: "lg", noFocus: true, actions: [{ label: "取消", value: null }, { label: "下一步：预览", kind: "primary", value: true }] });
    if (!ok) return;
    const pick = cands.filter((c) => c.on);
    if (!pick.length) return toast("没有勾选条目");
    await review({
      title: `搬 ${pick.length} 条到「${neu.name}」`,
      // 开关沿用旧版里的状态
      entries: pick.map((c) => ({ src: { name: c.p.name, content: c.p.content, prompt: c.p, from: old.name, srcDraft: old, srcId: c.id }, marker: c.marker, hook: c.hook || void 0, enabled: old.order.find((o) => o.identifier === c.id)?.enabled !== false }))
    });
  }
  const off = onDraftChange((name, kind) => {
    if (kind !== "status" && name === focusPreset() && draftViewVisible(page) && st.dstType === "preset") renderDst();
  });
  cleanups.push(off);
  return {
    render() {
      setPane(st.pane);
      renderSrcPick();
      renderSrc();
      renderDst();
    }
  };
}
