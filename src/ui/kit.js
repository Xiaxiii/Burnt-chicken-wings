// 界面组件库：转义与模板、提示、弹窗、菜单、选择器、输入框、原地改名，以及按钮、开关等小部件的 HTML。
// 3.0.0 重写。全部视图都用这里的部件，样式见 ui/style.css（类名前缀 cw-）。

var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c2) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c2]);
// 模板：插入的值一律转义；已是 HTML 的用 raw() 包一层，数组逐项拼接，null / false 不输出
class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const raw = (s) => s instanceof SafeHtml ? s : new SafeHtml(String(s ?? ""));
function showVal(v) {
  if (v == null || v === false || v === true) return "";
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(showVal).join("");
  return esc(v);
}
function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += showVal(vals[i]) + strings[i + 1];
  return new SafeHtml(out);
}
function toast(msg, type = "info") {
  const t = globalThis.toastr;
  if (t && t[type]) t[type](msg, "", { timeOut: type === "error" ? 6e3 : 2600, preventDuplicates: true });
  else console.log("[焦香鸡翅]", msg);
}
var rootEl = null;
// 等这一帧画出来再继续：先显示「正在…」，重活放到下一帧
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const isNarrow = () => (rootEl?.clientWidth || window.innerWidth) < 960;
function el(markup) {
  const t = document.createElement("template");
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
// 输入法正在选字时按的回车不算提交（Safari 报 keyCode 229）
const imeEnter = (e) => e.isComposing || e.keyCode === 229;
// 搜索框：停一下再筛；拼音还没选字时不筛；清空时立刻恢复
function onSearchInput(input, run, delay = 120) {
  if (!input) return;
  let timer = 0;
  const go = () => { clearTimeout(timer); timer = 0; run(input.value); };
  input.addEventListener("input", (e) => {
    if (e.isComposing) return;
    clearTimeout(timer);
    if (!input.value.trim() || delay <= 0) return go();
    timer = setTimeout(go, delay);
  });
  input.addEventListener("compositionend", () => { clearTimeout(timer); timer = setTimeout(go, 0); });
}
// 复制文字。http 打开的酒馆里浏览器不给 navigator.clipboard，退回选中再复制
async function copyText(text, input = null) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  const box = input || Object.assign(document.createElement("textarea"), { value: text });
  if (!input) {
    box.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;";
    (rootEl || document.body).append(box);
  }
  let ok = false;
  try {
    box.focus({ preventScroll: true });
    box.select();
    box.setSelectionRange(0, box.value.length);
    ok = document.execCommand("copy");
  } catch {}
  if (!input) box.remove();
  return ok;
}
// 最近点的按钮：菜单贴着它弹出
var lastTap = null;
const noteTap = (e) => {
  const b = e.target?.closest?.("button, [role=button], [data-act]");
  if (b) lastTap = { el: b, t: Date.now() };
};
function recentAnchor() {
  return lastTap && Date.now() - lastTap.t < 1500 && lastTap.el.isConnected && lastTap.el.offsetParent ? lastTap.el : null;
}
// ⓘ：点了展开同一块里的说明（data-tip ↔ data-tipnote，就近查找）
const onTipBtn = (e) => {
  const b = e.target?.closest?.("[data-tip]");
  if (!b) return;
  e.preventDefault();
  let note = null;
  for (let p = b.parentElement; p && !note; p = p.parentElement) note = [...p.children].find((c) => c.hasAttribute("data-tipnote")) || p.querySelector(":scope > * > [data-tipnote]");
  if (!note) return;
  note.hidden = !note.hidden;
  b.setAttribute("aria-expanded", String(!note.hidden));
};
function setRoot(node) {
  rootEl = node;
  node?.addEventListener("click", noteTap, true);
  node?.addEventListener("click", onTipBtn);
}
function layerEl() {
  return rootEl?.querySelector(".cw-layer") || rootEl || document.body;
}

// ---------- 小部件（返回 HTML） ----------
const iconHtml = (name) => raw(ICON[name] || "");
// kind：primary / danger / ghost / quiet；size：sm
function btn(label, { act = "", kind = "", size = "", icon = "", attrs = "", title = "", disabled = false, type = "button" } = {}) {
  const cls = ["cw-btn", kind && `cw-btn-${kind}`, size && `cw-btn-${size}`].filter(Boolean).join(" ");
  return html`<button type="${type}" class="${cls}"${act ? raw(` data-act="${esc(act)}"`) : ""}${title ? raw(` title="${esc(title)}"`) : ""}${disabled ? raw(" disabled") : ""}${raw(attrs ? " " + attrs : "")}>${icon ? iconHtml(icon) : ""}${label ? html`<span>${label}</span>` : ""}</button>`;
}
function ibtn(icon, label, { act = "", attrs = "", cls = "", pressed = null } = {}) {
  return html`<button type="button" class="cw-ibtn${cls ? " " + cls : ""}"${act ? raw(` data-act="${esc(act)}"`) : ""} aria-label="${label}" title="${label}"${pressed == null ? "" : raw(` aria-pressed="${pressed}"`)}${raw(attrs ? " " + attrs : "")}>${iconHtml(icon)}</button>`;
}
// 开关：mixed＝部分开启（滑块居中）
function switchHtml({ act = "", on = false, mixed = false, label = "", attrs = "", disabled = false, small = false } = {}) {
  return html`<label class="cw-switch${small ? " cw-switch-s" : ""}"${label ? raw(` title="${esc(label)}"`) : ""}><input type="checkbox"${act ? raw(` data-act="${esc(act)}"`) : ""}${on ? raw(" checked") : ""}${mixed ? raw(' data-mixed="1"') : ""}${disabled ? raw(" disabled") : ""}${label ? raw(` aria-label="${esc(label)}"`) : ""}${raw(attrs ? " " + attrs : "")}><i></i></label>`;
}
// 分段：items [[值, 文字]]
function segHtml(items, cur, { attr = "data-seg", label = "", size = "" } = {}) {
  return html`<div class="cw-seg${size ? " cw-seg-" + size : ""}" role="tablist"${label ? raw(` aria-label="${esc(label)}"`) : ""}>${items.map(([v, l]) => html`<button type="button" role="tab" ${raw(attr)}="${v}" aria-selected="${v === cur}" class="${v === cur ? "on" : ""}">${l}</button>`)}</div>`;
}
// 下划线页签
function tabsHtml(items, cur, { attr = "data-tab" } = {}) {
  return html`<div class="cw-tabs" role="tablist">${items.map(([v, l]) => html`<button type="button" role="tab" ${raw(attr)}="${v}" aria-selected="${v === cur}" class="${v === cur ? "on" : ""}">${l}</button>`)}</div>`;
}
// tone：accent / ok / warn / muted / line
const pill = (text, tone = "muted", title = "") => html`<span class="cw-pill cw-pill-${tone}"${title ? raw(` title="${esc(title)}"`) : ""}>${text}</span>`;
const empty = (text, extra = "") => html`<div class="cw-empty"><p>${text}</p>${raw(extra)}</div>`;
// ⓘ 与说明：note 是 HTML
const tipBtn = (label = "说明") => html`<button type="button" class="cw-tipbtn" data-tip aria-expanded="false" aria-label="${label}" title="${label}">${iconHtml("info")}</button>`;
const tipNote = (note) => html`<div class="cw-tipnote" data-tipnote hidden>${raw(note)}</div>`;
// 折叠段（details）：open 记在调用方
const fold = (summary, body, { open = false, cls = "", attrs = "" } = {}) => html`<details class="cw-fold${cls ? " " + cls : ""}"${open ? raw(" open") : ""}${raw(attrs ? " " + attrs : "")}><summary>${iconHtml("chev")}<span>${raw(summary)}</span></summary><div class="cw-fold-body">${raw(body)}</div></details>`;
const sizeBar = (v, max) => html`<i class="cw-meter"><b style="width:${Math.max(2, Math.round(v / (max || 1) * 100))}%"></b></i>`;

// ---------- 弹窗 ----------
// opt：title、sub、body（HTML 或节点）、actions [{ label, kind, value, validate }]、size（sm / md / lg / full）、
// onMount(wrap)、noFocus、focusInput、cls。关闭（✕、遮罩、Esc、返回手势）得到 null
function dialog(opt) {
  return new Promise((resolve) => {
    const size = opt.size || "md";
    const wrap = el(html`<div class="cw-scrim" data-size="${size}"><div class="cw-dlg${opt.cls ? " " + opt.cls : ""}" data-size="${size}" role="dialog" aria-modal="true" tabindex="-1" aria-label="${opt.title}">
        <header class="cw-dlg-head"><div class="cw-dlg-title"><b>${opt.title}</b>${opt.sub ? html`<small>${opt.sub}</small>` : ""}</div><button type="button" class="cw-ibtn cw-dlg-x" aria-label="关闭" title="关闭">${iconHtml("close")}</button></header>
        <div class="cw-dlg-body"></div>
        <footer class="cw-dlg-foot"></footer></div></div>`);
    const body = wrap.querySelector(".cw-dlg-body");
    if (opt.body instanceof Node) body.append(opt.body);
    else if (opt.body != null) body.innerHTML = String(opt.body);
    const foot = wrap.querySelector(".cw-dlg-foot");
    const acts = opt.actions || [{ label: "确定", kind: "primary", value: true }];
    let closed = false;
    const done = (v) => {
      if (closed) return;
      closed = true;
      wrap.classList.add("cw-out");
      setTimeout(() => wrap.remove(), reducedMotion() ? 0 : 160);
      document.removeEventListener("keydown", onKey, true);
      wrap.dispatchEvent(new Event("cw-closed"));
      resolve(v);
    };
    wrap.close = (v = null) => done(v);
    for (const a of acts) {
      const b = el(btn(a.label, { kind: a.kind || "" }));
      if (a.attrs) for (const [k, v] of Object.entries(a.attrs)) b.setAttribute(k, v);
      b.addEventListener("click", async () => {
        if (a.validate && !await a.validate(wrap)) return;
        done(typeof a.value === "function" ? a.value(wrap) : a.value);
      });
      foot.append(b);
    }
    if (!acts.length) foot.remove();
    wrap.querySelector(".cw-dlg-x").addEventListener("click", () => done(null));
    wrap.addEventListener("pointerdown", (e) => { wrap._downOnScrim = e.target === wrap; });
    wrap.addEventListener("click", (e) => { if (e.target === wrap && wrap._downOnScrim) done(null); });
    const isTop = () => {
      const all = layerEl().querySelectorAll(":scope > .cw-scrim:not(.cw-out), :scope > .cw-pop-scrim:not(.cw-out)");
      return all[all.length - 1] === wrap;
    };
    const onKey = (e) => {
      if (!isTop()) return;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        done(null);
        return;
      }
      if (e.key === "Tab") {
        const f = [...wrap.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const back = document.activeElement;
    wrap.addEventListener("cw-closed", () => { try { if (back?.isConnected) back.focus({ preventScroll: true }); } catch {} });
    layerEl().append(wrap);
    opt.onMount?.(wrap);
    const first = wrap.querySelector("input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea");
    if (first && !opt.noFocus && (opt.focusInput || matchMedia("(pointer:fine)").matches)) first.focus();
    else wrap.querySelector(".cw-dlg")?.focus({ preventScroll: true });
  });
}
// 旧写法兼容：place "center" → 小窗；wide → 大窗
function sheet(opt) {
  return dialog({ ...opt, size: opt.size || (opt.place === "center" ? "sm" : opt.wide ? "lg" : "md") });
}
function topDialog() {
  const all = layerEl().querySelectorAll(":scope > .cw-scrim:not(.cw-out), :scope > .cw-pop-scrim:not(.cw-out)");
  return all[all.length - 1] || null;
}

// ---------- 贴着按钮的菜单 ----------
// items：{ label, sub, value, danger, on（打勾）, pair: [{label, value}] }；返回选中的 value，点外面得到 null
function popover(anchor, build, { width = 300, cls = "" } = {}) {
  return new Promise((resolve) => {
    const wrap = el(html`<div class="cw-pop-scrim"><div class="cw-pop${cls ? " " + cls : ""}" role="menu" tabindex="-1"></div></div>`);
    const box = wrap.querySelector(".cw-pop");
    let closed = false;
    const done = (v) => {
      if (closed) return;
      closed = true;
      wrap.classList.add("cw-out");
      setTimeout(() => wrap.remove(), reducedMotion() ? 0 : 120);
      document.removeEventListener("keydown", onKey, true);
      try { anchor?.focus?.({ preventScroll: true }); } catch {}
      resolve(v);
    };
    build(box, done);
    wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap) done(null); });
    const onKey = (e) => {
      if (topDialog() !== wrap) return;
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); done(null); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const f = [...box.querySelectorAll("button:not(:disabled)")];
        if (!f.length) return;
        e.preventDefault();
        const i = f.indexOf(document.activeElement);
        f[(i + (e.key === "ArrowDown" ? 1 : -1) + f.length) % f.length].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    layerEl().append(wrap);
    // 位置：下方放得下放下方，否则放上方；右边对齐按钮，不出边
    const host = layerEl().getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const gap = 6, edge = 8;
    const w = Math.min(width, host.width - edge * 2);
    box.style.width = w + "px";
    const left = Math.min(Math.max(a.right - host.left - w, edge), host.width - w - edge);
    box.style.left = left + "px";
    const below = host.bottom - a.bottom - gap - edge, above = a.top - host.top - gap - edge;
    const ox = Math.min(Math.max(a.left + a.width / 2 - host.left - left, 0), w);
    if (box.offsetHeight <= below || below >= above) {
      box.style.top = a.bottom - host.top + gap + "px";
      box.style.maxHeight = below + "px";
      box.style.transformOrigin = `${ox}px top`;
    } else {
      box.style.bottom = host.bottom - a.top + gap + "px";
      box.style.maxHeight = above + "px";
      box.style.transformOrigin = `${ox}px bottom`;
    }
    box.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  });
}
function menuItemsHtml(items) {
  return items.map((it, i) => it.pair
    ? html`<div class="cw-menu-pair">${it.pair.map((p, j) => html`<button type="button" class="cw-menu-item" role="menuitem" data-v="${i}.${j}">${p.label}</button>`)}</div>`
    : it.sep ? raw('<hr class="cw-menu-sep">')
      : html`<button type="button" class="cw-menu-item${it.danger ? " cw-danger" : ""}${it.on ? " on" : ""}" role="menuitem" data-v="${i}"${it.disabled ? raw(" disabled") : ""}><span class="cw-menu-label">${it.label}</span>${it.sub ? html`<small>${it.sub}</small>` : ""}${it.on ? iconHtml("check") : ""}</button>`);
}
// 选项不多时贴着刚点的按钮弹出；带说明或选项多时放在弹窗里
async function pickBox(title, items, { hint = "", anchor = recentAnchor() } = {}) {
  const pick = (box, done) => {
    box.innerHTML = String(html`${title ? html`<div class="cw-menu-title">${title}</div>` : ""}${menuItemsHtml(items)}`);
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      const [i, j] = b.dataset.v.split(".");
      done(j === undefined ? items[Number(i)].value : items[Number(i)].pair[Number(j)].value);
    });
  };
  if (anchor && !hint && items.length <= 10) return popover(anchor, pick);
  let picked = null;
  await dialog({ title, size: "sm", noFocus: true, actions: [{ label: "取消", value: null }], body: html`${hint ? html`<p class="cw-hint">${hint}</p>` : ""}<div class="cw-menu cw-menu-flat"></div>`, onMount: (w) => {
    pick(w.querySelector(".cw-menu"), (v) => { picked = v; w.close(v); });
  } });
  return picked;
}
async function confirmBox(title, text, okLabel = "确定", danger = false) {
  const r = await dialog({ title, size: "sm", body: html`<p class="cw-p">${text}</p>`, actions: [{ label: "取消", value: false }, { label: okLabel, kind: danger ? "danger" : "primary", value: true }] });
  return !!r;
}
// 删除前提供备份下载，不强制：download() 下载并返回写进弹窗的说明（HTML）。返回 true 才删
async function confirmDeleteOfferBackup(title, bodyHtml, download) {
  let note = "";
  for (;;) {
    const v = await dialog({
      title, size: "sm",
      body: html`${raw(bodyHtml)}${note ? html`<p class="cw-hint cw-dl-note">${raw(note)}</p>` : ""}`,
      actions: [{ label: "取消", value: null }, { label: note ? "重新下载" : "下载备份", value: "dl" }, { label: "删除", kind: "danger", value: "del" }]
    });
    if (v === "del") return true;
    if (v !== "dl") return false;
    note = await download();
  }
}
async function promptBox(title, value = "", placeholder = "", { hint = "" } = {}) {
  return dialog({
    title, size: "sm",
    body: html`${hint ? html`<p class="cw-hint">${hint}</p>` : ""}<input class="cw-input" value="${value}" placeholder="${placeholder}" maxlength="120" aria-label="${title}">`,
    actions: [{ label: "取消", value: null }, { label: "确定", kind: "primary", value: (w) => w.querySelector("input").value.trim() || null }],
    onMount: (w) => {
      const i = w.querySelector("input");
      i.addEventListener("keydown", (e) => { if (e.key === "Enter" && !imeEnter(e)) w.querySelector(".cw-btn-primary").click(); });
      setTimeout(() => { i.focus(); i.select(); }, 60);
    }
  });
}
// 带搜索的名称选择（预设、世界书、角色卡…）。只有几个固定选项且不搜索时贴着按钮弹出
async function pickName({ title, items, current = null, search, extra = null } = {}) {
  const useSearch = search ?? true;
  const anchor = recentAnchor();
  if (!useSearch && items.length <= 9 && anchor) {
    return pickBox("", items.map((it) => ({ label: it.label ?? it.value, sub: it.sub, value: it.value, on: it.value === current })), { anchor });
  }
  let picked = null;
  const body = el(html`<div class="cw-chooser">
      <div class="cw-chooser-top">${useSearch ? html`<input class="cw-input" type="text" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="搜索" aria-label="搜索">` : ""}${extra ? html`<button type="button" class="cw-btn cw-btn-sm${extra.value === current ? " on" : ""}" data-v="${extra.value}">${extra.label}</button>` : ""}</div>
      <div class="cw-chooser-list" role="listbox"></div></div>`);
  const q = body.querySelector("input");
  const box = body.querySelector(".cw-chooser-list");
  const paint = () => {
    const k = (q?.value || "").trim().toLowerCase();
    const hits = items.filter((it) => !k || String(it.label ?? it.value).toLowerCase().includes(k) || String(it.sub || "").toLowerCase().includes(k));
    box.innerHTML = String(hits.length ? html`${hits.map((it) => html`<button type="button" class="cw-choice${it.value === current ? " on" : ""}" data-v="${it.value}" role="option" aria-selected="${it.value === current}"><span>${it.label ?? it.value}</span>${it.sub ? html`<small>${it.sub}</small>` : ""}${it.value === current ? iconHtml("check") : ""}</button>`)}` : html`<p class="cw-hint cw-pad">没有匹配的</p>`);
  };
  onSearchInput(q, paint, items.length > 150 ? 120 : 0);
  paint();
  await dialog({ title, body, noFocus: true, size: items.length > 8 ? "tall" : "md", actions: [], onMount: (w) => {
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      picked = b.dataset.v;
      w.close(picked);
    });
    box.querySelector(".on")?.scrollIntoView({ block: "center" });
    if (q && matchMedia("(pointer:fine)").matches) q.focus();
  } });
  return picked;
}
// 原地改名：把文字换成输入框，回车或点别处保存，Esc 取消。返回新名字，没改返回 null
function inlineEdit(target, value, { placeholder = "" } = {}) {
  return new Promise((resolve) => {
    const old = target.innerHTML;
    const input = el(html`<input class="cw-input cw-inline-input" value="${value}" placeholder="${placeholder}" maxlength="120" aria-label="新名称">`);
    target.innerHTML = "";
    target.append(input);
    let finished = false;
    const finish = (v) => {
      if (finished) return;
      finished = true;
      target.innerHTML = old;
      resolve(v && v !== value ? v : null);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !imeEnter(e)) { e.preventDefault(); finish(input.value.trim()); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
    });
    input.addEventListener("blur", () => finish(input.value.trim()));
    for (const t of ["click", "pointerdown"]) input.addEventListener(t, (e) => e.stopPropagation());
    setTimeout(() => { input.focus(); input.select(); }, 40);
  });
}
// 文件选择按钮：label 包着隐藏的文件框（键盘回车、空格也能打开）
const fileBtn = (label, { accept = ".json,application/json,text/plain", attr = "data-file", kind = "", icon = "" } = {}) =>
  html`<label class="cw-btn${kind ? " cw-btn-" + kind : ""}" role="button" tabindex="0">${icon ? iconHtml(icon) : ""}<span>${label}</span><input type="file" accept="${accept}" ${raw(attr)} hidden></label>`;
function bindFileKeys(box) {
  box.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("label[role=button]")) { e.preventDefault(); e.target.querySelector("input[type=file]")?.click(); }
  });
}
// 列表行从原处滑到新位置（FLIP）：before 是 Map(键 → 原来的 top)
function flipFrom(nodes, before, keyOf, ms = 180) {
  if (reducedMotion()) return;
  requestAnimationFrame(() => {
    const vh = window.innerHeight;
    for (const x of nodes) {
      const t0 = before.get(keyOf(x));
      if (t0 == null) continue;
      const r = x.getBoundingClientRect();
      const dy = t0 - r.top;
      if (Math.abs(dy) < 1 || Math.abs(dy) > vh || r.bottom < 0 || r.top > vh) continue;
      x.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: ms, easing: "cubic-bezier(.23, 1, .32, 1)" });
    }
  });
}
// 下载：交给浏览器
function stampNow() {
  const t = new Date(), two = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}${two(t.getMonth() + 1)}${two(t.getDate())}-${two(t.getHours())}${two(t.getMinutes())}`;
}
