// 外观。默认跟随酒馆主题（自动改为不透明，避免背景透出影响阅读），也可选用内置配色。
// 1.3.9：「花田」「晴野」为油画感渐变背景，替换原来的豆沙粉、雾霾蓝（沿用原 id，已选的设置不受影响）。
// 自定义背景图存在本浏览器的 IndexedDB，不写进酒馆设置文件，不影响酒馆加载速度。
var THEMES = [
  { id: "follow", name: "跟随酒馆主题", sub: "使用酒馆的配色" },
  { id: "bean", name: "花田", sub: "粉紫油画渐变", dots: ["#f6e6e6", "#b0607e", "#45343f"], paint: true },
  { id: "mist", name: "晴野", sub: "蓝黄油画渐变", dots: ["#f6f2dc", "#4f74a3", "#2f3a46"], paint: true },
  { id: "oat", name: "杏色", sub: "奶油杏", dots: ["#f2e6d8", "#8f6a4c", "#4d3f35"] },
  { id: "goose", name: "鹅黄", sub: "奶油黄", dots: ["#f3eed6", "#7d7245", "#45412c"] },
  { id: "matcha", name: "芽绿", sub: "奶油绿", dots: ["#e7ecda", "#627858", "#3a4234"] },
  { id: "night", name: "夜雾", sub: "深色", dots: ["#262a30", "#a9bfae", "#e4e1dc"] }
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
var bgUrl = null;
function applyTheme(root) {
  if (!root) return;
  // 1.4.0 去掉了薰衣草、海盐，选过的回到默认
  const id = THEMES.some((t) => t.id === settings().theme) ? settings().theme : "follow";
  root.dataset.theme = id;
  if (id !== "follow") {
    root.style.removeProperty("--pa-tint");
    root.style.removeProperty("--pa-input-bg");
    root.style.removeProperty("--pa-on-accent");
  } else {
    const cs = getComputedStyle(document.body);
    const tint = readColor(cs.getPropertyValue("--SmartThemeBlurTintColor").trim()) || { r: 28, g: 26, b: 30, a: 0.94 };
    root.style.setProperty("--pa-tint", `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${Math.max(tint.a, 0.97)})`);
    const light = (0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b) / 255 > 0.6;
    root.style.setProperty("--pa-input-bg", light ? "rgba(255, 255, 255, .72)" : "rgba(0, 0, 0, .2)");
    // 主按钮文字：强调色深用白字，浅用深字
    const acc = readColor(cs.getPropertyValue("--SmartThemeQuoteColor").trim()) || { r: 224, g: 162, b: 74 };
    const accL = (0.2126 * acc.r + 0.7152 * acc.g + 0.0722 * acc.b) / 255;
    root.style.setProperty("--pa-on-accent", accL < 0.55 ? "#fff" : "#1b1712");
  }
  applyBackground(root);
}
// 自定义背景图：图片上盖一层主题底色，浓度可调，保证文字清楚
async function applyBackground(root) {
  const bg = settings().bg || {};
  if (!bg.on) {
    root.classList.remove("pa-has-bg");
    return;
  }
  try {
    if (!bgUrl) {
      const blob = await assetGet("bg");
      if (!blob) {
        root.classList.remove("pa-has-bg");
        return;
      }
      bgUrl = URL.createObjectURL(blob);
    }
    const tint = readColor(getComputedStyle(root).getPropertyValue("--pa-tint").trim()) || { r: 240, g: 240, b: 240 };
    const veil = Math.min(0.9, Math.max(0, bg.veil ?? 0.55));
    root.style.setProperty("--pa-bg-img", `url("${bgUrl}")`);
    root.style.setProperty("--pa-bg-veil", `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${veil})`);
    root.classList.add("pa-has-bg");
  } catch (e) {
    console.warn("[裁缝铺] 背景图读取失败", e);
    root.classList.remove("pa-has-bg");
  }
}
// 选图后先缩小再存（最长边 1600 像素，JPEG），避免占用过多空间、拖慢打开
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  // 手机截图常带纯黑或纯白的边，先裁掉
  const box = trimBorders(bmp);
  const k = Math.min(1, 1600 / Math.max(box.w, box.h));
  const cv = document.createElement("canvas");
  cv.width = Math.round(box.w * k);
  cv.height = Math.round(box.h * k);
  cv.getContext("2d").drawImage(bmp, box.x, box.y, box.w, box.h, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return new Promise((resolve, reject) => cv.toBlob((b) => b ? resolve(b) : reject(new Error("图片处理失败")), "image/jpeg", 0.85));
}
// 找出四周整行/整列几乎同色（接近纯黑或纯白）的边，返回去掉这些边之后的区域
function trimBorders(bmp) {
  const W = 200;
  const k = W / bmp.width;
  const H = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  const flat = (cells) => {
    let dark = 0, light = 0;
    for (const i of cells) {
      const l = lum(i);
      if (l < 28) dark++;
      else if (l > 238) light++;
    }
    return dark / cells.length > 0.94 || light / cells.length > 0.94;
  };
  const row = (y) => Array.from({ length: W }, (_, x) => (y * W + x) * 4);
  const col = (x) => Array.from({ length: H }, (_, y) => (y * W + x) * 4);
  let top = 0, bottom = H - 1, left = 0, right = W - 1;
  while (top < bottom && flat(row(top))) top++;
  while (bottom > top && flat(row(bottom))) bottom--;
  while (left < right && flat(col(left))) left++;
  while (right > left && flat(col(right))) right--;
  // 缩小时边界会有一行过渡色，多裁一行
  if (top > 0) top++;
  if (bottom < H - 1) bottom--;
  if (left > 0) left++;
  if (right < W - 1) right--;
  // 裁掉太多（整张图本来就很暗或很亮）就不裁
  if ((bottom - top + 1) < H * 0.3 || (right - left + 1) < W * 0.3) return { x: 0, y: 0, w: bmp.width, h: bmp.height };
  const s = bmp.width / W;
  const x = Math.floor(left * s), y = Math.floor(top * s);
  return { x, y, w: Math.min(bmp.width - x, Math.ceil((right - left + 1) * s)), h: Math.min(bmp.height - y, Math.ceil((bottom - top + 1) * s)) };
}
function themeCards() {
  const cur = settings().theme || "follow";
  return `<div class="pa-themes">${THEMES.map((t) => {
    const dots = t.dots || ["var(--SmartThemeBlurTintColor, #333)", "var(--SmartThemeQuoteColor, #e0a24a)", "var(--SmartThemeBodyColor, #ddd)"];
    const style = t.dots && !t.paint ? `background:${t.dots[0]};color:${t.dots[2]};border-color:${t.dots[1]}55` : t.paint ? `color:${t.dots[2]};border-color:${t.dots[1]}55` : "";
    return `<button class="pa-theme${t.paint ? ` pa-paint-${t.id}` : ""}" data-theme-id="${t.id}" aria-pressed="${t.id === cur}" style="${style}">
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
function bgPanel() {
  const bg = settings().bg || {};
  return `<div class="pa-card pa-bgpanel">
      <div class="pa-card-act">
        <label class="pa-btn pa-btn-soft pa-file">${bg.on ? "更换图片" : "选择图片"}<input type="file" accept="image/*" data-bg="file" hidden></label>
        ${bg.on ? '<button class="pa-btn" data-bg="off">移除</button>' : ""}
      </div>
      ${bg.on ? `<label class="pa-field pa-field-row"><span>遮罩</span><input type="range" min="0" max="90" step="5" value="${Math.round((bg.veil ?? 0.55) * 100)}" data-bg="veil"><em class="pa-bg-veil-n">${Math.round((bg.veil ?? 0.55) * 100)}%</em></label>` : ""}
      <p class="pa-hint">图片只保存在本浏览器，不上传。遮罩越高，文字越清楚。</p>
    </div>`;
}
function bindBgPanel(box, rerender) {
  const root = () => document.getElementById("pa-root");
  box.addEventListener("change", async (e) => {
    const t = e.target.closest("[data-bg]");
    if (!t) return;
    if (t.dataset.bg === "file") {
      const f = t.files?.[0];
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
      return rerender();
    }
  });
  box.addEventListener("input", (e) => {
    const t = e.target.closest("[data-bg=veil]");
    if (!t) return;
    settings().bg = { ...settings().bg, veil: Number(t.value) / 100 };
    box.querySelector(".pa-bg-veil-n").textContent = `${t.value}%`;
    applyBackground(root());
  });
  box.addEventListener("change", (e) => {
    if (e.target.closest("[data-bg=veil]")) saveSettings();
  });
  box.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-bg=off]")) return;
    settings().bg = { ...settings().bg, on: false };
    saveSettings();
    await assetDel("bg").catch(() => {
    });
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = null;
    applyBackground(root());
    rerender();
  });
}
