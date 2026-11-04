// 2.7.0「连接」页：当前连接 → 方案 → 选项 → 站点（原「更多 → 方案」，提为一级页签）
function mountConn(page) {
  page.innerHTML = '<div class="pa-scroll pa-plan"><div class="pa-plan-live"></div><div class="pa-plan-schemes"></div><div class="pa-plan-opts"></div><div class="pa-plan-sites"></div></div>';
  const api = mountApi(page.querySelector(".pa-plan-live"), page.querySelector(".pa-plan-sites"), page.querySelector(".pa-plan-opts"));
  // 方案改动后刷新站点列表（站点标题显示被哪些预设的方案使用）
  const sc = mountSchemes(page.querySelector(".pa-plan-schemes"), { after: () => api.render() });
  return { render: () => sc.render(), destroy: sc.destroy };
}
// 「更多」页：外观、加载体检、清理，顶部分段切换（2.7.0 方案移到「连接」页）
function mountMore(page, app) {
  const SUBS = [["look", "外观"], ["health", "加载体检"], ["clean", "清理"]];
  page.innerHTML = `
    <div class="pa-more-head"><div class="pa-seg pa-seg-s" role="tablist">${SUBS.map(([k, l]) => `<button data-m="${k}">${l}</button>`).join("")}</div></div>
    ${SUBS.map(([k]) => `<section class="pa-subpage" data-mp="${k}" hidden></section>`).join("")}`;
  const sec = (k) => page.querySelector(`[data-mp="${k}"]`);
  const subs = {
    look: (() => {
      const box = sec("look");
      box.innerHTML = `<div class="pa-scroll"><h3 class="pa-h">入口</h3><div class="pa-entryslot"></div><div class="pa-look"></div><h3 class="pa-h">文字大小</h3><div class="pa-fsslot"></div><div class="pa-hrow"><h3 class="pa-h">背景图</h3><button class="pa-why" data-bgwhy type="button" aria-label="说明" aria-expanded="false" title="说明">${INFO_ICON}</button></div><div class="pa-whynote" hidden>图片只保存在本浏览器，不上传。遮罩越高，文字越清楚。</div><div class="pa-bgslot"></div></div>`;
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
      // 2.5.4 入口自选，和「文字大小」一样的分段按钮；选「都不要」时下面写怎么打开
      const entrySlot = box.querySelector(".pa-entryslot");
      entrySlot.addEventListener("click", (e) => { const b = e.target.closest("[data-entry]"); if (b) setEntryMode(b.dataset.entry); });
      const render = () => {
        entrySlot.innerHTML = `<div class="pa-seg pa-seg-s" role="group" aria-label="打开焦香鸡翅的入口">${ENTRY_MODES.map(([k, l]) => `<button type="button" data-entry="${k}" class="${k === entryMode() ? "on" : ""}">${l}</button>`).join("")}</div>
          <small class="pa-dim pa-entry-note pa-noentry" ${entryMode() === "none" ? "" : "hidden"}>${NO_ENTRY_NOTE}</small>`;
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
  let cur = settings().moreTab && subs[settings().moreTab] ? settings().moreTab : "look";
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
  return { render: () => show(subs[settings().moreTab] ? settings().moreTab : cur), show };
}
