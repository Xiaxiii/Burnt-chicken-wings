var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c2) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c2]);
function toast(msg, type = "info") {
  const t = globalThis.toastr;
  if (t && t[type]) t[type](msg, "", { timeOut: type === "error" ? 6e3 : 2600, preventDuplicates: true });
  else console.log("[裁缝铺]", msg);
}
var rootEl = null;
function setRoot(el2) {
  rootEl = el2;
}
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function sheet(opt) {
  return new Promise((resolve) => {
    const wrap = el(`<div class="pa-sheet-mask"><div class="pa-sheet ${opt.wide ? "pa-sheet-wide" : ""}" role="dialog" aria-label="${esc(opt.title)}">
            <div class="pa-sheet-head"><b>${esc(opt.title)}</b><button class="pa-icon-btn pa-sheet-x" aria-label="关闭">✕</button></div>
            <div class="pa-sheet-body"></div>
            <div class="pa-sheet-actions"></div></div></div>`);
    const body = wrap.querySelector(".pa-sheet-body");
    if (typeof opt.body === "string") body.innerHTML = opt.body;
    else if (opt.body) body.append(opt.body);
    const acts = wrap.querySelector(".pa-sheet-actions");
    const done = (v) => {
      wrap.classList.add("pa-out");
      setTimeout(() => wrap.remove(), 160);
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    for (const a of opt.actions || [{ label: "好", kind: "primary", value: true }]) {
      const b = el(`<button class="pa-btn ${a.kind ? "pa-btn-" + a.kind : ""}">${esc(a.label)}</button>`);
      b.addEventListener("click", async () => {
        if (a.validate) {
          const ok = await a.validate(wrap);
          if (!ok) return;
        }
        done(typeof a.value === "function" ? a.value(wrap) : a.value);
      });
      acts.append(b);
    }
    if (!(opt.actions || []).length) acts.remove();
    wrap.querySelector(".pa-sheet-x").addEventListener("click", () => done(null));
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) done(null);
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    (rootEl || document.body).append(wrap);
    opt.onMount?.(wrap);
    const first = wrap.querySelector("input:not([type=checkbox]):not([type=radio]), textarea");
    if (first && !opt.noFocus && matchMedia("(pointer:fine)").matches) first.focus();
  });
}
async function confirmBox(title, text, okLabel = "确定", danger = false) {
  const r = await sheet({ title, body: `<p class="pa-p">${esc(text)}</p>`, actions: [{ label: "取消", value: false }, { label: okLabel, kind: danger ? "danger" : "primary", value: true }] });
  return !!r;
}
async function promptBox(title, value = "", placeholder = "") {
  return sheet({
    title,
    body: `<input class="pa-input" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120">`,
    actions: [{ label: "取消", value: null }, { label: "确定", kind: "primary", value: (w) => w.querySelector("input").value.trim() || null }],
    onMount: (w) => {
      const i = w.querySelector("input");
      i.addEventListener("keydown", (e) => {
        if (e.key === "Enter") w.querySelector(".pa-btn-primary").click();
      });
      setTimeout(() => {
        i.focus();
        i.select();
      }, 60);
    }
  });
}
async function pickBox(title, items, { hint = "" } = {}) {
  const body = el(`<div>${hint ? `<p class="pa-hint">${esc(hint)}</p>` : ""}<div class="pa-pick"></div></div>`);
  const list = body.querySelector(".pa-pick");
  let resolveFn;
  const p = sheet({ title, body, actions: [{ label: "取消", value: null }], onMount: (w) => {
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      resolveFn(items[Number(b.dataset.v)].value);
      w.querySelector(".pa-sheet-x").click();
    });
  } });
  let picked = null;
  resolveFn = (v) => {
    picked = v;
  };
  list.innerHTML = items.map((it, i) => `<button class="pa-pick-item" data-v="${i}">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</button>`).join("") || '<p class="pa-hint">没有可选的</p>';
  await p;
  return picked;
}
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

