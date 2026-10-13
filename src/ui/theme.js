// 1.3.0：外观。默认跟随酒馆美化（自动补成不透明，免得背景透出来看不清），也可以换内置的莫兰迪色卡
var THEMES = [
  { id: "follow", name: "跟随酒馆美化", sub: "颜色跟酒馆走，自动变成不透明" },
  { id: "mist", name: "雾霾蓝", sub: "安静、清透", dots: ["#e9eef2", "#5b7a93", "#34404c"] },
  { id: "bean", name: "豆沙粉", sub: "温柔、软乎乎", dots: ["#f4e9e8", "#a0605d", "#4f3c3c"] },
  { id: "matcha", name: "抹茶绿", sub: "清新、护眼", dots: ["#e9efe6", "#5d7d58", "#36443a"] },
  { id: "oat", name: "燕麦奶茶", sub: "暖暖的米色", dots: ["#f2ece4", "#8a6a4c", "#4a3f35"] },
  { id: "lavender", name: "薰衣草", sub: "淡紫、梦幻", dots: ["#edeaf3", "#72649a", "#403a4f"] },
  { id: "seasalt", name: "海盐", sub: "蓝绿、凉凉的", dots: ["#e6efef", "#4b7a7b", "#2f4344"] },
  { id: "night", name: "夜雾", sub: "深色，晚上用", dots: ["#262a30", "#a9bfae", "#e4e1dc"] }
];
function readColor(value) {
  if (!value) return null;
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = value;
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
}
function applyTheme(root) {
  if (!root) return;
  const id = THEMES.some((t) => t.id === settings().theme) ? settings().theme : "follow";
  root.dataset.theme = id;
  if (id !== "follow") {
    root.style.removeProperty("--pa-tint");
    root.style.removeProperty("--pa-input-bg");
    root.style.removeProperty("--pa-on-accent");
    return;
  }
  const cs = getComputedStyle(document.body);
  const tint = readColor(cs.getPropertyValue("--SmartThemeBlurTintColor").trim()) || { r: 28, g: 26, b: 30, a: 0.94 };
  root.style.setProperty("--pa-tint", `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${Math.max(tint.a, 0.97)})`);
  const light = (0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255 > 0.6;
  root.style.setProperty("--pa-input-bg", light ? "rgba(255, 255, 255, .72)" : "rgba(0, 0, 0, .2)");
  // 主按钮的字：强调色深就用白字，浅就用深字
  const acc = readColor(cs.getPropertyValue("--SmartThemeQuoteColor").trim()) || { r: 224, g: 162, b: 74 };
  const accL = (0.2126 * acc.r + 0.7152 * acc.g + 0.0722 * acc.b) / 255;
  root.style.setProperty("--pa-on-accent", accL < 0.55 ? "#fff" : "#1b1712");
}
function themeCards() {
  const cur = settings().theme || "follow";
  return `<div class="pa-themes">${THEMES.map((t) => {
    const dots = t.dots || ["var(--SmartThemeBlurTintColor, #333)", "var(--SmartThemeQuoteColor, #e0a24a)", "var(--SmartThemeBodyColor, #ddd)"];
    const style = t.dots ? `background:${t.dots[0]};color:${t.dots[2]};border-color:${t.dots[1]}55` : "";
    return `<button class="pa-theme" data-theme-id="${t.id}" aria-pressed="${t.id === cur}" style="${style}">
        <span class="pa-theme-dots">${dots.map((c2) => `<i style="background:${c2}"></i>`).join("")}</span>
        <b>${esc(t.name)}</b><small>${esc(t.sub)}</small></button>`;
  }).join("")}</div>`;
}
function bindThemeCards(box, after) {
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-id]");
    if (!b) return;
    settings().theme = b.dataset.themeId;
    saveSettings();
    applyTheme(document.getElementById("pa-root"));
    box.querySelectorAll("[data-theme-id]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    after?.();
  });
}
async function themeSheet() {
  const body = el(`<div>${themeCards()}</div>`);
  bindThemeCards(body);
  await sheet({ title: "换个颜色", body, wide: true, actions: [{ label: "好了", kind: "primary", value: true }] });
}
