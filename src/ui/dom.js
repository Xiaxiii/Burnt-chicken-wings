var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c2) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c2]);
function toast(msg, type = "info") {
  const t = globalThis.toastr;
  if (t && t[type]) t[type](msg, "", { timeOut: type === "error" ? 6e3 : 2600, preventDuplicates: true });
  else console.log("[焦香鸡翅]", msg);
}
var rootEl = null;
// 等这一帧画出来再继续：先显示「正在…」，重活放到下一帧
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
// 2.5.0 最近点的按钮：菜单贴着它弹出，不再从屏幕底部升上来
var lastTap = null;
const noteTap = (e) => {
  const b = e.target?.closest?.("button, [role=button], [data-a], [data-act], [data-tool], [data-s]");
  if (b) lastTap = { el: b, t: Date.now() };
};
function recentAnchor() {
  return lastTap && Date.now() - lastTap.t < 1500 && lastTap.el.isConnected && lastTap.el.offsetParent ? lastTap.el : null;
}
// 2.5.0 ⓘ 按钮（data-tipbtn）展开同一块里的说明（data-tipnote），整个面板共用，不用每处单独绑定
const onTipBtn = (e) => {
  const b = e.target?.closest?.("[data-tipbtn]");
  if (!b) return;
  e.preventDefault();
  let note = null;
  for (let p = b.parentElement; p && !note; p = p.parentElement) note = [...p.children].find((c) => c.hasAttribute("data-tipnote")) || null;
  if (!note) return;
  note.hidden = !note.hidden;
  b.setAttribute("aria-expanded", String(!note.hidden));
  b.classList.toggle("on", !note.hidden);
};
function setRoot(el2) {
  rootEl = el2;
  el2?.addEventListener("click", noteTap, true);
  el2?.addEventListener("click", onTipBtn);
}
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function sheet(opt) {
  return new Promise((resolve) => {
    // place：省略时手机上从底部升起、电脑上居中（大窗口）；"center" 屏幕中间偏上的小卡片；"pop" 贴着 anchor 弹出的菜单
    const place = opt.place === "pop" && opt.anchor ? "pop" : opt.place === "center" ? "center" : "";
    const wrap = el(`<div class="pa-sheet-mask${place ? ` pa-mask-${place}` : ""}"><div class="pa-sheet ${opt.wide ? "pa-sheet-wide" : ""}${place ? ` pa-sheet-${place}` : ""}${opt.cls ? ` ${opt.cls}` : ""}" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(opt.title)}">
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
    if (place === "pop") placePop(wrap, opt.anchor);
    opt.onMount?.(wrap);
    const first = wrap.querySelector("input:not([type=checkbox]):not([type=radio]), textarea");
    // focusInput：触屏上也直接把光标放进输入框（弹出键盘），用于点了就要打字的搜索窗
    if (first && !opt.noFocus && (opt.focusInput || matchMedia("(pointer:fine)").matches)) first.focus();
    else wrap.querySelector(".pa-sheet")?.focus({ preventScroll: true });
  });
}
// 2.5.0 原地改名：把这段文字换成输入框，回车或点别处保存，Esc 取消。返回新名字，没改返回 null
function inlineEdit(target, value, { placeholder = "" } = {}) {
  return new Promise((resolve) => {
    const old = target.innerHTML;
    const input = el(`<input class="pa-input pa-inline-input" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120" aria-label="新名称">`);
    target.innerHTML = "";
    target.append(input);
    target.classList.add("pa-inline-editing");
    let finished = false;
    const finish = (v) => {
      if (finished) return;
      finished = true;
      target.classList.remove("pa-inline-editing");
      target.innerHTML = old;
      resolve(v && v !== value ? v : null);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !imeEnter(e)) { e.preventDefault(); finish(input.value.trim()); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
    });
    input.addEventListener("blur", () => finish(input.value.trim()));
    for (const t of ["click", "pointerdown"]) input.addEventListener(t, (e) => e.stopPropagation());
    setTimeout(() => {
      input.focus();
      input.select();
    }, 40);
  });
}
// 贴着按钮放菜单：下面放得下就放下面，否则放上面；右边对齐按钮，不出边
function placePop(wrap, anchor) {
  const box = wrap.querySelector(".pa-sheet");
  const host = (rootEl || document.body).getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const gap = 6, edge = 8;
  const w = Math.min(320, host.width - edge * 2);
  box.style.width = w + "px";
  const left = Math.min(Math.max(a.right - host.left - w, edge), host.width - w - edge);
  box.style.left = left + "px";
  const below = host.bottom - a.bottom - gap - edge;
  const above = a.top - host.top - gap - edge;
  const h = box.offsetHeight;
  if (h <= below || below >= above) {
    box.style.top = a.bottom - host.top + gap + "px";
    box.style.maxHeight = below + "px";
  } else {
    box.style.bottom = host.bottom - a.top + gap + "px";
    box.style.maxHeight = above + "px";
  }
}
async function confirmBox(title, text, okLabel = "确定", danger = false) {
  const r = await sheet({ title, place: "center", body: `<p class="pa-p">${esc(text)}</p>`, actions: [{ label: "取消", value: false }, { label: okLabel, kind: danger ? "danger" : "primary", value: true }] });
  return !!r;
}
// 删除前的备份是交给浏览器下载的：浏览器可能弹窗询问、被拦截或下载失败，这里没法知道文件是否真的存到了本地。
// 所以下载之后先停一下，由用户确认文件已经保存，再继续删除。返回 true 才删。
async function confirmDownloaded(fileName, redownload) {
  for (;;) {
    const v = await sheet({
      title: "确认备份已保存",
      body: `<p class="pa-p">已让浏览器下载「${esc(fileName)}」。浏览器可能会询问、拦截或下载失败，请先在浏览器的下载记录里确认文件已经保存，再继续删除。</p>`,
      actions: [{ label: "取消删除", value: null }, { label: "重新下载", value: "redo" }, { label: "已保存，继续删除", kind: "danger", value: "ok" }]
    });
    if (v === "redo") {
      redownload();
      continue;
    }
    return v === "ok";
  }
}
async function promptBox(title, value = "", placeholder = "") {
  return sheet({
    title,
    place: "center",
    body: `<input class="pa-input" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120">`,
    actions: [{ label: "取消", value: null }, { label: "确定", kind: "primary", value: (w) => w.querySelector("input").value.trim() || null }],
    onMount: (w) => {
      const i = w.querySelector("input");
      i.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !imeEnter(e)) w.querySelector(".pa-btn-primary").click();
      });
      setTimeout(() => {
        i.focus();
        i.select();
      }, 60);
    }
  });
}
// 2.5.0 选项不多的菜单贴着刚点的按钮弹出（点外面关掉）；选项多或带说明时放在屏幕中间
async function pickBox(title, items, { hint = "", anchor = recentAnchor() } = {}) {
  const body = el(`<div>${hint ? `<p class="pa-hint">${esc(hint)}</p>` : ""}<div class="pa-pick"></div></div>`);
  const list = body.querySelector(".pa-pick");
  let resolveFn;
  const pop = !!anchor && !hint && items.length <= 9;
  // 先填好选项再弹出，贴按钮时才量得准高度
  // item.pair：一行放两个短按钮（如 ↑ 上移、↓ 下移），值写成 "序号.0" / "序号.1"
  list.innerHTML = items.map((it, i) => it.pair
    ? `<div class="pa-pick-pair">${it.pair.map((p, j) => `<button class="pa-pick-item" data-v="${i}.${j}">${esc(p.label)}</button>`).join("")}</div>`
    : `<button class="pa-pick-item" data-v="${i}"><span class="pa-pick-label">${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</button>`).join("") || '<p class="pa-hint">无可选项</p>';
  const p = sheet({ title, body, place: pop ? "pop" : "center", anchor, actions: pop ? [] : [{ label: "取消", value: null }], onMount: (w) => {
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      const [i, j] = b.dataset.v.split(".");
      resolveFn(j === undefined ? items[Number(i)].value : items[Number(i)].pair[Number(j)].value);
      w.querySelector(".pa-sheet-x").click();
    });
  } });
  let picked = null;
  resolveFn = (v) => {
    picked = v;
  };
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

// 说明文字默认收起：一行小字「ⓘ 说明」，点开再看。手机屏幕小，长段说明不要一上来就铺满
// 2.4.1 解释句默认收起：标题或选项旁一个 ⓘ，点开才显示；bindWhy 挂在外层容器上
// ⓘ 字符在不少字体里偏上偏小，和文字对不齐；画一个圆圈 i
// 2.5.7 输入法正在选字时按的回车（确认拼音候选）不算提交。Safari 在这个回车上报 keyCode 229
const imeEnter = (e) => e.isComposing || e.keyCode === 229;
// 2.5.7 搜索框：停一下再筛，连打几个字只筛一次（大预设在手机上筛一次要一两百毫秒）；
// 拼音还没选字时不筛（输入法每打一个字母都会触发 input）；清空时立刻恢复
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
const INFO_ICON = '<svg class="pa-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/></svg>';
const whyBtn = (key) => `<button class="pa-why" type="button" data-why="${key}" aria-label="说明" aria-expanded="false" title="说明">${INFO_ICON}</button>`;
const whyNote = (key, html) => `<div class="pa-whynote" data-whynote="${key}" hidden>${html}</div>`;
function bindWhy(box) {
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-why]");
    if (!b || !box.contains(b)) return;
    // 在 label 里时不让它顺带勾选或聚焦
    e.preventDefault();
    const note = box.querySelector(`[data-whynote="${CSS.escape(b.dataset.why)}"]`);
    if (!note) return;
    note.hidden = !note.hidden;
    b.setAttribute("aria-expanded", String(!note.hidden));
  });
}
function tip(inner, label = "说明") {
  if (!String(inner || "").trim()) return "";
  return `<details class="pa-tip"><summary>${INFO_ICON}${esc(label)}</summary><div class="pa-tip-body">${inner}</div></details>`;
}
