// 「更多」页：方案（含 API 站点）、外观、加载体检、清理，顶部分段切换
function mountMore(page, app) {
  const SUBS = [["schemes", "方案"], ["look", "外观"], ["health", "加载体检"], ["clean", "清理"]];
  page.innerHTML = `
    <div class="pa-more-head"><div class="pa-seg pa-seg-s" role="tablist">${SUBS.map(([k, l]) => `<button data-m="${k}">${l}</button>`).join("")}</div></div>
    ${SUBS.map(([k]) => `<section class="pa-subpage" data-mp="${k}" hidden></section>`).join("")}`;
  const sec = (k) => page.querySelector(`[data-mp="${k}"]`);
  const subs = {
    // 1.4.0：开关方案和 API 站点合并为一页：当前连接 → 方案 → 站点
    // 2.4.0：两个选项（换角色提示、推理格式跟随预设）放在方案下面，站点那块只放站点
    schemes: (() => {
      const box = sec("schemes");
      box.innerHTML = '<div class="pa-scroll pa-plan"><div class="pa-plan-live"></div><div class="pa-plan-schemes"></div><div class="pa-plan-opts"></div><div class="pa-plan-sites"></div></div>';
      const api = mountApi(box.querySelector(".pa-plan-live"), box.querySelector(".pa-plan-sites"), box.querySelector(".pa-plan-opts"));
      // 方案改动后刷新站点列表（站点标题显示被哪些预设的方案使用）
      const sc = mountSchemes(box.querySelector(".pa-plan-schemes"), { after: () => api.render() });
      return { render: () => sc.render(), destroy: sc.destroy };
    })(),
    look: (() => {
      const box = sec("look");
      box.innerHTML = `<div class="pa-scroll"><div class="pa-ballrow"><h3 class="pa-h">悬浮球</h3><label class="pa-switch" title="显示悬浮球"><input type="checkbox" data-o="floatball" aria-label="显示悬浮球"><i></i></label></div><h3 class="pa-h">配色</h3><div class="pa-look"></div><h3 class="pa-h">文字大小</h3><div class="pa-fsslot"></div><div class="pa-hrow"><h3 class="pa-h">背景图</h3><button class="pa-why" data-bgwhy type="button" aria-label="说明" aria-expanded="false" title="说明">ⓘ</button></div><div class="pa-whynote" hidden>图片只保存在本浏览器，不上传。遮罩越高，文字越清楚。</div><div class="pa-bgslot"></div></div>`;
      const slot = box.querySelector(".pa-look");
      const bgSlot = box.querySelector(".pa-bgslot");
      const fsSlot = box.querySelector(".pa-fsslot");
      bindFontSize(fsSlot);
      // 2.3.6 背景图的说明放在标题同一行最右边
      const bgWhy = box.querySelector("[data-bgwhy]");
      bgWhy.addEventListener("click", () => {
        const note = bgWhy.parentElement.nextElementSibling;
        note.hidden = !note.hidden;
        bgWhy.setAttribute("aria-expanded", String(!note.hidden));
      });
      const ballBox = box.querySelector("[data-o=floatball]");
      ballBox.addEventListener("change", () => setFloatBall(ballBox.checked));
      const render = () => {
        ballBox.checked = settings().floatBall === true;
        fsSlot.innerHTML = fontSizeSeg();
        slot.innerHTML = themeCards();
        bgSlot.innerHTML = bgPanel();
      };
      bindThemeCards(slot);
      bindBgPanel(bgSlot, render);
      return { render };
    })(),
    health: mountHealth(sec("health"), { goClean: () => { show("clean"); saveSettings(); } }),
    clean: mountCleanup(sec("clean"))
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
