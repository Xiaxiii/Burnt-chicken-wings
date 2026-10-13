// 1.3.0：方案、API、外观合并成一个「更多」页，上面用小分段切换
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
      box.innerHTML = `<div class="pa-scroll"><h3 class="pa-h">颜色</h3><div class="pa-look"></div>
        <p class="pa-hint">「跟随酒馆美化」会用酒馆主题的颜色，并自动补成不透明，免得背景透出来看不清字。想要固定的配色就选下面的莫兰迪色卡。</p></div>`;
      const slot = box.querySelector(".pa-look");
      const render = () => { slot.innerHTML = themeCards(); };
      bindThemeCards(slot);
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
