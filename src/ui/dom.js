var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c2) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c2]);
function toast(msg, type = "info") {
  const t = globalThis.toastr;
  if (t && t[type]) t[type](msg, "", { timeOut: type === "error" ? 6e3 : 2600, preventDuplicates: true });
  else console.log("[焦香鸡翅]", msg);
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
    const wrap = el(`<div class="pa-sheet-mask"><div class="pa-sheet ${opt.wide ? "pa-sheet-wide" : ""}" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(opt.title)}">
            <div class="pa-sheet-head"><b>${esc(opt.title)}</b><button class="pa-icon-btn pa-sheet-x" aria-label="关闭">✕</button></div>
            <div class="pa-sheet-body"></div>
            <div class="pa-sheet-actions"></div></div></div>`);
    const body = wrap.querySelector(".pa-sheet-body");
    if (typeof opt.body === "string") body.innerHTML = opt.body;
    else if (opt.body) body.append(opt.body);
    const acts = wrap.querySelector(".pa-sheet-actions");
    const done = (v) => {
      if (wrap.classList.contains("pa-out")) return;
      wrap.classList.add("pa-out");
      setTimeout(() => wrap.remove(), 160);
      document.removeEventListener("keydown", onKey, true);
      wrap.dispatchEvent(new Event("pa-closed"));
      resolve(v);
    };
    for (const a of opt.actions || [{ label: "确定", kind: "primary", value: true }]) {
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
    // 叠着好几个弹窗时，Esc 和 Tab 只给最上面那个
    const isTop = () => {
      const all = (rootEl || document.body).querySelectorAll(".pa-sheet-mask:not(.pa-out)");
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
        // 焦点留在弹窗里
        const f = [...wrap.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && (i === -1 || i === f.length - 1)) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const back = document.activeElement;
    const restoreFocus = () => { try { if (back?.isConnected) back.focus({ preventScroll: true }); } catch {} };
    wrap.addEventListener("pa-closed", restoreFocus);
    (rootEl || document.body).append(wrap);
    opt.onMount?.(wrap);
    const first = wrap.querySelector("input:not([type=checkbox]):not([type=radio]), textarea");
    if (first && !opt.noFocus && matchMedia("(pointer:fine)").matches) first.focus();
    else wrap.querySelector(".pa-sheet")?.focus({ preventScroll: true });
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
  list.innerHTML = items.map((it, i) => `<button class="pa-pick-item" data-v="${i}">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</button>`).join("") || '<p class="pa-hint">无可选项</p>';
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

