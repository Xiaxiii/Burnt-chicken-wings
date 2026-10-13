// 「更多」页：开关方案、API 站点、外观、加载体检，顶部分段切换
function mountMore(page, app) {
  const SUBS = [["schemes", "方案"], ["look", "外观"], ["health", "加载体检"]];
  page.innerHTML = `
    <div class="pa-more-head"><div class="pa-seg pa-seg-s" role="tablist">${SUBS.map(([k, l]) => `<button data-m="${k}">${l}</button>`).join("")}</div></div>
    ${SUBS.map(([k]) => `<section class="pa-subpage" data-mp="${k}" hidden></section>`).join("")}`;
  const sec = (k) => page.querySelector(`[data-mp="${k}"]`);
  const subs = {
    // 1.4.0：开关方案和 API 站点合并为一页：当前连接 → 方案 → 站点
    schemes: (() => {
      const box = sec("schemes");
      box.innerHTML = '<div class="pa-scroll pa-plan"><div class="pa-plan-live"></div><div class="pa-plan-schemes"></div><div class="pa-plan-sites"></div></div>';
      const api = mountApi(box.querySelector(".pa-plan-live"), box.querySelector(".pa-plan-sites"));
      // 方案改动后刷新站点列表（站点标题显示被哪些预设的方案使用）
      const sc = mountSchemes(box.querySelector(".pa-plan-schemes"), { after: () => api.render() });
      return { render: () => sc.render(), destroy: sc.destroy };
    })(),
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
  if (settings().moreTab === "api") settings().moreTab = "schemes";
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
  return { render: () => show(subs[settings().moreTab] ? settings().moreTab : cur), destroy: () => { subs.schemes.destroy?.(); } };
}
