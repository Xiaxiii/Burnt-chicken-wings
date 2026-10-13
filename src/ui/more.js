// 「更多」页：开关方案、API 站点、外观、加载体检，顶部分段切换
function mountMore(page, app) {
  const SUBS = [["schemes", "开关方案"], ["api", "API 站点"], ["look", "外观"], ["health", "加载体检"]];
  page.innerHTML = `
    <div class="pa-more-head"><div class="pa-seg pa-seg-s" role="tablist">${SUBS.map(([k, l]) => `<button data-m="${k}">${l}</button>`).join("")}</div></div>
    ${SUBS.map(([k]) => `<section class="pa-subpage" data-mp="${k}" hidden></section>`).join("")}`;
  const sec = (k) => page.querySelector(`[data-mp="${k}"]`);
  const subs = {
    schemes: mountSchemes(sec("schemes"), app),
    api: mountApi(sec("api"), app),
    look: (() => {
      const box = sec("look");
      box.innerHTML = `<div class="pa-scroll"><h3 class="pa-h">配色</h3><div class="pa-look"></div><h3 class="pa-h">背景图</h3><div class="pa-bgslot"></div></div>`;
      const slot = box.querySelector(".pa-look");
      const bgSlot = box.querySelector(".pa-bgslot");
      const render = () => {
        slot.innerHTML = themeCards();
        bgSlot.innerHTML = bgPanel();
      };
      bindThemeCards(slot);
      bindBgPanel(bgSlot, render);
      return { render };
    })(),
    health: mountHealth(sec("health"))
  };
  let cur = settings().moreTab && subs[settings().moreTab] ? settings().moreTab : "schemes";
  function show(k) {
    cur = k;
    settings().moreTab = k;
    page.querySelectorAll("[data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === k));
    page.querySelectorAll("[data-mp]").forEach((s) => { s.hidden = s.dataset.mp !== k; });
    subs[k].render();
  }
  page.querySelector(".pa-more-head").addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (b) { show(b.dataset.m); saveSettings(); }
  });
  return { render: () => show(subs[settings().moreTab] ? settings().moreTab : cur), destroy: () => { subs.schemes.destroy?.(); subs.api.destroy?.(); } };
}
