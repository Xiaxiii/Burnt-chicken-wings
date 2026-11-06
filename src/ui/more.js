// 「更多」页：方案（含 API 站点）、外观、加载体检、清理，顶部分段切换
function mountMore(page, app, options = {}) {
  const ALL_SUBS = [["schemes", "方案"], ["look", "外观"], ["health", "加载体检"], ["clean", "清理"]];
  const SUBS = options.subs?.length ? ALL_SUBS.filter(([k]) => options.subs.includes(k)) : ALL_SUBS;
  page.innerHTML = `
    <div class="pa-more-head"><div class="pa-seg pa-seg-s" role="tablist">${SUBS.map(([k, l]) => `<button data-m="${k}">${l}</button>`).join("")}</div></div>
    ${SUBS.map(([k]) => `<section class="pa-subpage" data-mp="${k}" hidden></section>`).join("")}`;
  const sec = (k) => page.querySelector(`[data-mp="${k}"]`);
  const subs = {};
  if (SUBS.some(([k]) => k === "schemes")) subs.schemes = (() => {
    const box = sec("schemes");
    box.innerHTML = '<div class="pa-scroll pa-plan"><div class="pa-plan-live"></div><div class="pa-plan-schemes"></div><div class="pa-plan-opts"></div><div class="pa-plan-sites"></div></div>';
    const api = mountApi(box.querySelector(".pa-plan-live"), box.querySelector(".pa-plan-sites"), box.querySelector(".pa-plan-opts"));
    const sc = mountSchemes(box.querySelector(".pa-plan-schemes"), { after: () => api.render() });
    return { render: () => sc.render(), destroy: sc.destroy };
  })();
  if (SUBS.some(([k]) => k === "look")) subs.look = (() => {
    const box = sec("look");
    box.innerHTML = `<div class="pa-scroll"><h3 class="pa-h">入口</h3><div class="pa-entryslot"></div><div class="pa-look"></div><h3 class="pa-h">文字大小</h3><div class="pa-fsslot"></div><div class="pa-hrow"><h3 class="pa-h">背景图</h3><button class="pa-why" data-bgwhy type="button" aria-label="说明" aria-expanded="false" title="说明">${INFO_ICON}</button></div><div class="pa-whynote" hidden>图片只保存在本浏览器，不上传。遮罩越高，文字越清楚。</div><div class="pa-bgslot"></div></div>`;
    const slot = box.querySelector(".pa-look"), bgSlot = box.querySelector(".pa-bgslot"), fsSlot = box.querySelector(".pa-fsslot");
    bindFontSize(fsSlot);
    const bgWhy = box.querySelector("[data-bgwhy]");
    bgWhy.addEventListener("click", () => { const note = bgWhy.parentElement.nextElementSibling; note.hidden = !note.hidden; bgWhy.setAttribute("aria-expanded", String(!note.hidden)); });
    const entrySlot = box.querySelector(".pa-entryslot");
    entrySlot.addEventListener("click", (e) => { const b = e.target.closest("[data-entry]"); if (b) setEntryMode(b.dataset.entry); });
    const render = () => {
      entrySlot.innerHTML = `<div class="pa-seg pa-seg-s" role="group" aria-label="打开焦香鸡翅的入口">${ENTRY_MODES.map(([k, l]) => `<button type="button" data-entry="${k}" class="${k === entryMode() ? "on" : ""}">${l}</button>`).join("")}</div><small class="pa-dim pa-entry-note pa-noentry" ${entryMode() === "none" ? "" : "hidden"}>${NO_ENTRY_NOTE}</small>`;
      fsSlot.innerHTML = fontSizeSeg(); slot.innerHTML = themeCards(); bgSlot.innerHTML = bgPanel();
    };
    bindThemeCards(slot); bindBgPanel(bgSlot, render);
    return { render };
  })();
  if (SUBS.some(([k]) => k === "health")) subs.health = mountHealth(sec("health"), { goClean: () => { show("clean"); saveSettings(); } });
  if (SUBS.some(([k]) => k === "clean")) subs.clean = mountCleanup(sec("clean"));
  if (settings().moreTab === "api") settings().moreTab = "schemes";
  let cur = settings().moreTab && subs[settings().moreTab] ? settings().moreTab : SUBS[0][0];
  function show(k) {
    if (!subs[k]) k = cur;
    cur = k; settings().moreTab = k;
    page.querySelectorAll("[data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === k));
    page.querySelectorAll("[data-mp]").forEach((s) => { s.hidden = s.dataset.mp !== k; });
    subs[k].render();
  }
  page.querySelector(".pa-more-head").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b) { show(b.dataset.m); saveSettings(); } });
  return { render: () => show(subs[settings().moreTab] ? settings().moreTab : cur), destroy: () => { subs.schemes?.destroy?.(); } };
}
