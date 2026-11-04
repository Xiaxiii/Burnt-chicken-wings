// 外壳：宽屏左侧导航栏，窄屏顶栏加底部页签；当前预设（全局）、保存状态、详情栏；打开、关闭、返回手势。
var shellRoot = null;
var pages = {};
var currentPage = "preset";
// 一级页面：[键, 名称, 图标]
var NAV_MAIN = [["preset", "预设", "preset"], ["stitch", "缝合", "stitch"], ["reply", "回复", "reply"], ["conn", "连接", "conn"]];
var NAV_SUB = [["clean", "清理", "clean"], ["backup", "备份", "backup"], ["health", "体检", "health"], ["look", "外观", "look"]];
var PAGE_TITLE = Object.fromEntries([...NAV_MAIN, ...NAV_SUB, ["more", "更多"]].map(([k, l]) => [k, l]));
function injectStyle() {
  document.getElementById("cw-style")?.remove();
  const s = document.createElement("style");
  s.id = "cw-style";
  s.textContent = style_default;
  document.head.append(s);
}
// 按实际可见高度定面板高度（有的外壳里 100dvh 比看得见的区域高）；网页本身没盖住状态栏、底部横条时，不再额外留安全区
function syncViewport() {
  const r = shellRoot;
  if (!r) return;
  const h = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
  if (h > 0) r.style.setProperty("--cw-vh", h + "px");
  let probe = document.getElementById("cw-safe-probe");
  if (!probe) {
    probe = document.createElement("div");
    probe.id = "cw-safe-probe";
    probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.documentElement.append(probe);
  }
  const cs = getComputedStyle(probe);
  const t = parseFloat(cs.paddingTop) || 0, b = parseFloat(cs.paddingBottom) || 0;
  const land = window.innerWidth > window.innerHeight;
  const sw = window.screen?.width || 0, sh0 = window.screen?.height || 0;
  const sh = land ? Math.min(sw, sh0) : Math.max(sw, sh0);
  const gap = sh && h ? Math.max(0, sh - h) : 0;
  r.style.setProperty("--cw-sat", (t && gap >= t - 2 ? 0 : t) + "px");
  r.style.setProperty("--cw-sab", (b && t > 0 && gap >= t + b - 2 ? 0 : b) + "px");
  // 外层被别的样式改了定位基准（transform 等）时，面板顶部会偏移：补回来
  if (!r.hidden) {
    r.style.top = "0px";
    const off = r.getBoundingClientRect().top;
    if (Math.abs(off) > 1) r.style.top = -off + "px";
  }
}
const navBtn = ([k, l, ic], attr = "data-nav") => html`<button type="button" ${raw(attr)}="${k}">${iconHtml(ic)}<span>${l}</span></button>`;
function buildShell() {
  document.getElementById("cw-root")?.remove();
  shellRoot = el(html`<div id="cw-root" class="cw-root" hidden>
    <div class="cw-app">
      <aside class="cw-side" aria-label="导航">
        <div class="cw-brand"><span class="cw-logo">${iconHtml("logo")}</span><b class="cw-appname">${appName()}</b><small>by EC</small></div>
        <button type="button" class="cw-scope" data-act="scope" aria-label="当前预设"><small>当前预设</small><span class="cw-scope-name"></span>${iconHtml("chevDown")}</button>
        <nav class="cw-nav">${NAV_MAIN.map((x) => navBtn(x))}</nav>
        <nav class="cw-nav">${NAV_SUB.map((x) => navBtn(x))}</nav>
        <div class="cw-side-foot">${VERSION}</div>
      </aside>
      <div class="cw-main">
        <header class="cw-top">
          <span class="cw-logo cw-mobile-only">${iconHtml("logo")}</span>
          <button type="button" class="cw-scope cw-mobile-only" data-act="scope" aria-label="当前预设"><small>当前预设</small><span class="cw-scope-name"></span>${iconHtml("chevDown")}</button>
          <h1 class="cw-top-title cw-desk-only"></h1>
          <span class="cw-top-gap"></span>
          <div class="cw-save" aria-live="polite"></div>
          ${ibtn("close", "关闭", { act: "close" })}
        </header>
        <div class="cw-stage">
          <div class="cw-pages">${[...NAV_MAIN, ...NAV_SUB, ["more"]].map(([k]) => html`<section class="cw-page" data-page="${k}" hidden></section>`)}</div>
        </div>
        <nav class="cw-tabbar" aria-label="页面">${[...NAV_MAIN, ["more", "更多", "grid"]].map((x) => navBtn(x))}</nav>
      </div>
    </div>
    <div class="cw-layer"></div>
  </div>`);
  document.body.append(shellRoot);
  setRoot(shellRoot);
  syncViewport();
  const onVp = () => syncViewport();
  window.addEventListener("resize", onVp);
  window.addEventListener("orientationchange", onVp);
  window.visualViewport?.addEventListener("resize", onVp);
  cleanups.push(() => { window.removeEventListener("resize", onVp); window.removeEventListener("orientationchange", onVp); window.visualViewport?.removeEventListener("resize", onVp); });
  const pageEl = (k) => shellRoot.querySelector(`.cw-page[data-page="${k}"]`);
  pages = {
    preset: mountPresetPage(pageEl("preset")),
    stitch: mountStitchPage(pageEl("stitch")),
    reply: mountReplyPage(pageEl("reply")),
    conn: mountConnPage(pageEl("conn")),
    clean: mountCleanPage(pageEl("clean")),
    backup: mountBackupPage(pageEl("backup")),
    health: mountHealthPage(pageEl("health")),
    look: mountLookPage(pageEl("look")),
    more: mountMorePage(pageEl("more"))
  };
  applyTheme(shellRoot);
  // 键盘：在条目行、分组头上按回车或空格，等于点一下
  shellRoot.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.matches("[data-key-click]")) return;
    e.preventDefault();
    t.click();
  });
  shellRoot.addEventListener("click", async (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav && !nav.closest(".cw-page")) return show(nav.dataset.nav);
    const a = e.target.closest(".cw-top [data-act], .cw-side [data-act]")?.dataset.act;
    if (a === "close") return close();
    if (a === "scope") return pickScope();
    if (a === "undo") {
      const d = getDraft(focusPreset());
      const label = d.undo();
      if (label) {
        toast(`已撤销：${label}`);
        emitChange(d.name);
      }
    }
    if (a === "confirm") {
      try {
        await confirmDraft(focusPreset());
        toast("已完成，这批修改已保存", "success");
      } catch (err) {
        handleSaveError(focusPreset(), err);
      }
    }
    if (a === "retry") {
      const name = focusPreset();
      if (saveBlocked.has(name)) return resolveSaveProblem(name);
      try {
        await saveDraft(name, "保存");
        toast("已保存", "success");
      } catch (err) {
        handleSaveError(name, err);
      }
      updateSaveStatus();
    }
  });
  cleanups.push(onDraftChange((name, kind) => {
    updateSaveStatus();
    if (kind === "focus") paintScope();
  }));
}
async function pickScope() {
  const using = currentPresetName();
  const v = await pickName({ title: "当前预设", current: focusPreset(), items: listPresets().map((n) => ({ value: n, sub: n === using ? "使用中" : "" })) });
  if (!v || v === focusPreset()) return;
  closeDetail();
  setFocusPreset(v);
  paintScope();
  show(currentPage);
}
function paintScope() {
  if (!shellRoot) return;
  const name = focusPreset() || "未选预设";
  const using = name === currentPresetName();
  shellRoot.querySelectorAll(".cw-scope").forEach((b) => {
    const s = b.querySelector(".cw-scope-name");
    s.textContent = name;
    s.insertAdjacentHTML("beforeend", using ? '<span class="cw-using">使用中</span>' : "");
    b.title = name;
  });
}
// 保存状态：当前预设的草稿。有未确认的修改时给「撤销」「完成」
function updateSaveStatus() {
  if (!shellRoot) return;
  const box = shellRoot.querySelector(".cw-save");
  let d = null;
  try { d = getDraft(focusPreset()); } catch {}
  const err = !!d && saveErrors.has(d.name);
  const blocked = d ? saveBlocked.get(d.name) : null;
  const pending = !!d?.history.length;
  const busy = !!d && (saveJobs.has(d.name) || d.dirty);
  if (!d || !pending && !err && !busy) { box.innerHTML = ""; return; }
  const text = blocked ? (blocked.kind === "conflict" ? "已暂停：别处改过" : "已暂停：备份失败") : err ? `保存失败：${String(saveErrors.get(d.name)).slice(0, 40)}` : busy ? "保存中…" : "已保存";
  box.innerHTML = String(html`<span class="cw-save-dot${err || blocked ? " bad" : busy ? " busy" : ""}"></span><span class="cw-save-text${err || blocked ? " bad" : ""}" title="${text}">${text}</span>
    ${err || blocked ? btn(blocked ? "处理" : "重试", { act: "retry", size: "sm", kind: "primary" }) : ""}
    ${pending ? btn("撤销", { act: "undo", size: "sm", icon: "undo", title: "撤销上一步" }) : ""}
    ${pending && !err ? btn("完成", { act: "confirm", size: "sm", title: "修改已自动保存。点「完成」结束这一批修改，之后不能再撤销" }) : ""}`);
}
// 旧入口兼容：open("organize" | "cot" | "suture" | "more", sub)
function pageOf(tab, sub) {
  if (tab === "organize") return ["preset", "entries"];
  if (tab === "cot") return ["preset", "cot"];
  if (tab === "suture") return ["stitch"];
  if (tab === "more") {
    const m = sub || "";
    if (m === "schemes" || m === "api") return ["conn"];
    if (m === "health" || m === "look" || m === "clean") return [m];
    return ["more"];
  }
  return [tab];
}
function show(page, view) {
  if (!pages[page]) page = "preset";
  if (page === "more" && !isNarrow()) page = "clean";
  if (currentPage !== page) closeDetail();
  currentPage = page;
  settings().uiPage = page;
  shellRoot.querySelectorAll("[data-nav]").forEach((b) => {
    const on = b.dataset.nav === page || b.dataset.nav === "more" && NAV_SUB.some(([k]) => k === page);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  shellRoot.querySelectorAll(".cw-page").forEach((p) => { p.hidden = p.dataset.page !== page; });
  shellRoot.querySelector(".cw-top-title").textContent = PAGE_TITLE[page] || "";
  try {
    if (view && pages[page].setView) pages[page].setView(view);
    pages[page].render();
  } catch (e) {
    console.error(e);
    toast("出错：" + e.message, "error");
  }
  paintScope();
  updateSaveStatus();
}
function refreshPanel() {
  if (shellRoot && !shellRoot.hidden) show(currentPage);
}
function open(tab, sub) {
  if (!shellRoot) buildShell();
  let page = settings().uiPage || "preset", view = null;
  if (tab) [page, view] = pageOf(tab, sub);
  shellRoot.querySelectorAll(".cw-page").forEach((p) => { p.hidden = true; });
  dropClean();
  setFocusPreset(currentPresetName());
  applyTheme(shellRoot);
  shellRoot.hidden = false;
  syncViewport();
  document.documentElement.classList.add("cw-open");
  document.getElementById("cw-ball")?.setAttribute("hidden", "");
  show(page, view);
  pushBackState();
  setTimeout(flushAsks, 0);
}
// ---------- 详情栏 ----------
// 宽屏在主区右侧打开，窄屏整屏推入。opt：title、body（HTML 或节点）、actions [{ label, kind, value }]、onMount(box)。
// 返回 Promise：点了操作得到它的 value（函数则调用），关闭得到 null
var detailState = null;
function openDetail(opt) {
  closeDetail();
  return new Promise((resolve) => {
    const stage = shellRoot.querySelector(".cw-stage");
    const box = el(html`<aside class="cw-detail" role="dialog" aria-label="${opt.title}" tabindex="-1">
      <header class="cw-detail-head">${ibtn("back", "返回", { act: "detail-close", cls: "cw-mobile-back" })}<b>${opt.title}</b>${ibtn("close", "关闭", { act: "detail-close" })}</header>
      <div class="cw-detail-body"></div>
      <footer class="cw-detail-foot"></footer></aside>`);
    box.querySelector(isNarrow() ? '.cw-ibtn[aria-label="关闭"]' : ".cw-mobile-back")?.remove();
    const body = box.querySelector(".cw-detail-body");
    if (opt.body instanceof Node) body.append(opt.body);
    else body.innerHTML = String(opt.body || "");
    const foot = box.querySelector(".cw-detail-foot");
    const done = (v) => {
      if (detailState?.box !== box) return;
      detailState = null;
      box.remove();
      stage.classList.remove("cw-has-detail");
      resolve(v);
    };
    for (const a of opt.actions || []) {
      const b = el(btn(a.label, { kind: a.kind || "" }));
      b.addEventListener("click", async () => {
        if (a.validate && !await a.validate(box)) return;
        done(typeof a.value === "function" ? a.value(box) : a.value);
      });
      foot.append(b);
    }
    if (!(opt.actions || []).length) foot.remove();
    box.addEventListener("click", (e) => { if (e.target.closest('[data-act="detail-close"]')) done(null); });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !topDialog()) { e.stopPropagation(); e.preventDefault(); done(null); }
    });
    detailState = { box, done, key: opt.key || null };
    stage.append(box);
    stage.classList.add("cw-has-detail");
    opt.onMount?.(box);
    box.focus({ preventScroll: true });
  });
}
function closeDetail() {
  detailState?.done(null);
}
// ---------- 关闭、返回 ----------
var backArmed = false;
function pushBackState() {
  if (backArmed) return;
  try {
    history.pushState({ ...(history.state || {}), paOpen: true }, "");
    backArmed = true;
  } catch {}
}
function onPopState() {
  if (!backArmed) return;
  backArmed = false;
  if (!shellRoot || shellRoot.hidden) return;
  // 有弹窗时，返回只关弹窗；有详情栏时只关详情栏
  const top = topDialog();
  if (top) {
    if (top.close) top.close(null);
    else top.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    pushBackState();
    return;
  }
  if (detailState) {
    closeDetail();
    pushBackState();
    return;
  }
  close({ fromBack: true });
}
function onRootKey(e) {
  if (e.key !== "Escape" || !shellRoot || shellRoot.hidden) return;
  if (topDialog()) return; // 弹窗自己处理
  if (e.target?.classList?.contains("cw-inline-input")) return;
  if (detailState) { e.preventDefault(); return closeDetail(); }
  e.preventDefault();
  close();
}
async function close({ fromBack = false } = {}) {
  // 已经发出的保存撤不回来：先等它们结束，再看还剩哪些没存上
  if (saveJobs.size) {
    toast("正在等保存完成…");
    for (const job of [...saveJobs.values()]) { try { await job; } catch {} }
  }
  const dirty = dirtyDrafts().filter((d) => !saveBlocked.has(d.name));
  const blocked = dirtyDrafts().filter((d) => saveBlocked.has(d.name));
  if (blocked.length) {
    if (fromBack) pushBackState();
    for (const d of blocked) await resolveSaveProblem(d.name);
    if (dirtyDrafts().some((d) => saveBlocked.has(d.name))) return;
  }
  if (dirty.length) {
    if (fromBack) pushBackState();
    const r = await dialog({
      size: "sm",
      title: "有未保存的修改",
      body: html`<p class="cw-p">${dirty.map((d) => `「${d.name}」`).join("")}有还没存上的修改。</p><p class="cw-hint">「放弃」只丢掉还没存上的部分；之前已经自动保存的修改不会撤回${backupOn() ? "，需要时可在「备份」页恢复到修改前" : ""}。</p>`,
      actions: [{ label: "暂不处理（下次打开仍在）", value: "keep" }, { label: "放弃没存上的部分", kind: "danger", value: "drop" }, { label: "全部保存", kind: "primary", value: "save" }]
    });
    if (!r) return;
    if (r === "keep") dirty.forEach((d) => checkpoint(d));
    if (r === "drop") dirty.forEach((d) => dropDraft(d.name));
    if (r === "save") {
      for (const d of dirty) {
        try {
          await saveDraft(d.name, "保存");
        } catch (e) {
          handleSaveError(d.name, e);
          return;
        }
      }
      toast("已全部保存", "success");
    }
  }
  closeDetail();
  shellRoot.hidden = true;
  document.documentElement.classList.remove("cw-open");
  document.getElementById("cw-ball")?.removeAttribute("hidden");
  flushPresetNotice();
  if (backArmed) {
    backArmed = false;
    try { history.back(); } catch {}
  }
}
// 「更多」（窄屏）：清理、备份、体检、外观
function mountMorePage(page) {
  const DESC = { clean: "预设、扩展数据、角色卡、世界书", backup: "本浏览器里的预设与世界书备份", health: "酒馆打开慢，慢在哪里", look: "入口、配色、文字大小、背景图" };
  page.innerHTML = String(html`<div class="cw-body"><div class="cw-col"><div class="cw-morelist">${NAV_SUB.map(([k, l, ic]) => html`<button type="button" class="cw-moreitem" data-nav="${k}">${iconHtml(ic)}<span><b>${l}</b><small>${DESC[k]}</small></span>${iconHtml("chev")}</button>`)}</div>
    <p class="cw-hint cw-more-ver">${appName()} ${VERSION} · by EC</p></div></div>`);
  page.addEventListener("click", (e) => {
    const b = e.target.closest("[data-nav]");
    if (b) show(b.dataset.nav);
  });
  return { render() {} };
}
