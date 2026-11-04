// 「外观」页：入口、配色、文字大小、背景图
function mountLookPage(page) {
  page.innerHTML = String(html`<div class="cw-body"><div class="cw-col cw-look">
      <section class="cw-sec"><div class="cw-sec-h"><h3>入口</h3></div><div data-r="entry"></div></section>
      <section class="cw-sec"><div class="cw-sec-h"><h3>配色</h3><span class="cw-gap"></span><label class="cw-inline-switch"><span>跟随系统</span>${switchHtml({ act: "followsys", label: "跟随系统深浅色", attrs: 'data-r="follow"' })}</label></div>
        <p class="cw-hint" data-r="follownote" hidden>系统为深色时用夜雾，浅色时用选中的配色。</p>
        <div class="cw-themes" data-r="themes" role="group" aria-label="配色"></div></section>
      <section class="cw-sec"><div class="cw-sec-h"><h3>文字大小</h3><small>只对这台设备生效</small></div><div data-r="fs"></div></section>
      <section class="cw-sec"><div class="cw-sec-h"><h3>背景图</h3><span class="cw-gap"></span>${tipBtn()}</div>${tipNote("<p>图片只保存在本浏览器，不上传。选图时裁掉黑白边、缩到 1600 像素以内。遮罩越高，文字越清楚。</p>")}<div class="cw-card" data-r="bg"></div></section>
    </div></div>`);
  const $ = (k) => page.querySelector(`[data-r="${k}"]`);
  const root = () => document.getElementById("cw-root");
  function render() {
    $("entry").innerHTML = String(html`${segHtml(ENTRY_MODES, entryMode(), { attr: "data-entry", label: "打开焦香鸡翅的入口" })}<p class="cw-hint cw-noentry"${entryMode() === "none" ? "" : raw(" hidden")}>${NO_ENTRY_NOTE}</p>`);
    const { theme: cur, followSystem } = themePrefs();
    $("follow").checked = !!followSystem;
    $("follownote").hidden = !followSystem;
    $("themes").innerHTML = String(html`${THEMES.map((t) => {
      const dots = t.dots || ["var(--SmartThemeBlurTintColor, #333)", "var(--SmartThemeQuoteColor, #e0a24a)", "var(--SmartThemeBodyColor, #ddd)"];
      // 卡片用配色自己的底色和字色；夜间防护规则会强改字色，这里用 !important 保住
      const style = t.dots && !t.paint ? `background:${t.dots[0]};color:${t.dots[2]} !important;border-color:${t.dots[1]}55` : t.paint ? `color:${t.fg || t.dots[2]} !important;border-color:${t.dots[1]}55` : "";
      return html`<button type="button" class="cw-theme${t.paint ? ` cw-paint-${t.id}` : ""}" data-theme-id="${t.id}" aria-pressed="${t.id === cur}" style="${style}">
        <span class="cw-theme-dots">${dots.map((c) => html`<i style="background:${c}"></i>`)}</span><b>${t.name}</b><small>${t.sub}</small>${t.id === cur ? iconHtml("check") : ""}</button>`;
    })}`);
    $("fs").innerHTML = String(segHtml([["s", "小"], ["m", "标准"], ["l", "大"]], fontSizePref(), { attr: "data-fs", label: "文字大小" }));
    const bg = settings().bg || {};
    const veil = Math.round((bg.veil ?? 0.55) * 100);
    $("bg").innerHTML = String(html`<div class="cw-card-acts cw-bg-acts">${fileBtn(bg.on ? "更换图片" : "选择图片", { accept: "image/*", attr: 'data-bg="file"', icon: "fileIn", kind: bg.on ? "" : "primary" })}${bg.on ? btn("移除", { act: "bg-off" }) : html`<small class="cw-dim">未设置</small>`}</div>
      ${bg.on ? html`<label class="cw-range"><span>遮罩</span><input type="range" min="0" max="90" step="5" value="${veil}" data-bg="veil" aria-label="遮罩"><em>${veil}%</em></label>` : ""}`);
  }
  page.addEventListener("click", async (e) => {
    const en = e.target.closest("[data-entry]");
    if (en) return setEntryMode(en.dataset.entry), render();
    const th = e.target.closest("[data-theme-id]");
    if (th) {
      themePrefs();
      settings().theme = th.dataset.themeId;
      saveSettings();
      applyTheme(root());
      return render();
    }
    const fs = e.target.closest("[data-fs]");
    if (fs) {
      try { localStorage.setItem(FS_KEY, fs.dataset.fs); } catch {}
      if (root()) root().dataset.fs = fs.dataset.fs;
      return render();
    }
    if (e.target.closest('[data-act="bg-off"]')) {
      settings().bg = { ...settings().bg, on: false };
      saveSettings();
      await assetDel("bg").catch(() => {});
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      bgUrl = null;
      applyBackground(root());
      render();
    }
  });
  page.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.act === "followsys") {
      themePrefs();
      settings().followSystem = t.checked;
      saveSettings();
      applyTheme(root());
      return render();
    }
    if (t.dataset.bg === "veil") return saveSettings();
    if (t.dataset.bg === "file") {
      const f = t.files?.[0];
      t.value = "";
      if (!f) return;
      try {
        const blob = await shrinkImage(f);
        await assetPut("bg", blob);
        if (bgUrl) URL.revokeObjectURL(bgUrl);
        bgUrl = null;
        settings().bg = { ...settings().bg || {}, on: true, veil: settings().bg?.veil ?? 0.55 };
        saveSettings();
        await applyBackground(root());
        toast("背景图已设置", "success");
      } catch (err) {
        toast("背景图设置失败：" + err.message, "error");
      }
      render();
    }
  });
  page.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.bg !== "veil") return;
    settings().bg = { ...settings().bg, veil: Number(t.value) / 100 };
    t.parentElement.querySelector("em").textContent = `${t.value}%`;
    applyBackground(root());
  });
  bindFileKeys(page);
  return { render };
}
