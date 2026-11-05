// 主题引擎：配色、对比度校正、宿主强改字色防护、背景图、文字大小（原 ui/theme.js 的逻辑部分）
// 外观。默认跟随酒馆主题（自动改为不透明，避免背景透出影响阅读），也可选用内置配色。
// 1.3.9：「花田」「晴野」为油画感渐变背景，替换原来的豆沙粉、雾霾蓝（沿用原 id，已选的设置不受影响）。
// 2.3.8：「芽体」「菌落」为清透油画底 + 毛玻璃面板（glass）；去掉「春芽」。
// 自定义背景图存在本浏览器的 IndexedDB，不写进酒馆设置文件，不影响酒馆加载速度。
var THEMES = [
  { id: "atelier", name: "青序", sub: "冷绿灰工作台", dots: ["#eff4f0", "#1b6c80", "#243b31"] },
  { id: "follow", name: "跟随酒馆主题", sub: "使用酒馆的配色" },
  { id: "bean", fg: "#45343f", name: "花田", sub: "粉紫油画渐变", dots: ["#f6e6e6", "#b0607e", "#45343f"], paint: true },
  { id: "mist", fg: "#2f3a46", name: "晴野", sub: "蓝黄油画渐变", dots: ["#f6f2dc", "#4f74a3", "#2f3a46"], paint: true },
  { id: "oat", fg: "#4a3438", name: "秋樱", sub: "粉色花海", dots: ["#f4dcd9", "#b5566a", "#a9b48c"], paint: true },
  { id: "sage", fg: "#2c3a58", name: "海雾", sub: "雾蓝粉橙水彩", dots: ["#f6e6da", "#5a6e9e", "#f0b878"], paint: true },
  { id: "goose", fg: "#3d4540", name: "春和", sub: "粉绿水彩", dots: ["#fbded0", "#d1e5d9", "#bdcdb0"], paint: true },
  { id: "taro", fg: "#4a4160", name: "玫瑰芋泥", sub: "粉紫朦胧水彩", dots: ["#f5e8f3", "#cdbddb", "#9c91b8"], paint: true },
  { id: "dusk", fg: "#1f4a55", name: "日落海岸", sub: "海蓝到橘粉的晚霞", dots: ["#f3e8ab", "#f87078", "#026d81"], paint: true },
  { id: "bud", fg: "#2f423d", name: "芽体", sub: "青绿珊瑚毛玻璃", dots: ["#a9d5d1", "#f0c9b8", "#657f78"], paint: true, glass: true },
  { id: "colony", fg: "#303f47", name: "菌落", sub: "冷雾蓝紫毛玻璃", dots: ["#b8d4e7", "#d8d0e6", "#667d87"], paint: true, glass: true },
  { id: "night", name: "夜雾", sub: "深色", dots: ["#262a30", "#a9bfae", "#e4e1dc"] }
];

function readColor(value) {
  if (!value) return null;
  if (!CSS.supports("color", value)) return null;
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (hex) {
    const full = hex[1].length < 5 ? [...hex[1]].map(c => c + c).join("") : hex[1];
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1 };
  }
  const plain = /^rgba?\(([\d\s.,/]+)\)$/.exec(value);
  if (plain) {
    const [r, g, b, a = 1] = plain[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    if ([r, g, b, a].every(Number.isFinite)) return { r: Math.min(255, r), g: Math.min(255, g), b: Math.min(255, b), a: Math.min(1, a) };
  }
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.setProperty("color", value, "important");
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const srgb = /^color\(srgb\s+([^)]*)\)/.exec(c);
  if (srgb) {
    const [r, g, b, a = 1] = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
    return { r: r * 255, g: g * 255, b: b * 255, a };
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
}

function themeRgb(c) {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

function themeMix(fg, bg, a = fg.a ?? 1) {
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

function themeLuminance(c) {
  const linear = (n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
  return .2126 * linear(c.r) + .7152 * linear(c.g) + .0722 * linear(c.b);
}

function themeContrast(a, b) {
  const x = themeLuminance(a), y = themeLuminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

// 保留原主题色相，仅在文字/控件与面板太接近时向深色或浅色调整。
function readableThemeColor(color, surfaces, minimum) {
  const original = themeMix(color, surfaces[0]);
  const score = (c) => Math.min(...surfaces.map((bg) => themeContrast(c, bg)));
  if (score(original) >= minimum) return original;
  const dark = { r: 0, g: 0, b: 0 }, light = { r: 255, g: 255, b: 255 };
  const end = score(dark) >= score(light) ? dark : light;
  if (score(end) < minimum) return end;
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const k = (lo + hi) / 2;
    if (score(themeMix(end, original, k)) >= minimum + .03) hi = k;
    else lo = k;
  }
  return themeMix(end, original, hi);
}

var themeWatcher = null;

function watchTheme(root) {
  if (themeWatcher?.root === root) return;
  themeWatcher?.stop();
  let frame = 0;
  const refresh = () => {
    if (root.hidden || !root.isConnected || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!root.hidden && root.isConnected) applyTheme(root);
    });
  };
  // 不观察条目、聊天内容或整个 DOM 子树；宿主换主题时只合并处理一次。
  const observer = new MutationObserver(refresh);
  for (const node of [document.documentElement, document.body]) observer.observe(node, { attributes: true, attributeFilter: ["class", "style"] });
  // 2.5.8 Safari 13 及更早只有 addListener
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (media?.addEventListener) media.addEventListener("change", refresh);
  else media?.addListener?.(refresh);
  const stop = () => {
    observer.disconnect(); cancelAnimationFrame(frame);
    if (media?.removeEventListener) media.removeEventListener("change", refresh);
    else media?.removeListener?.(refresh);
  };
  themeWatcher = { root, stop };
  // 扩展/脚本重载走应用现有销毁流程，释放旧面板和媒体监听。
  if (typeof cleanups !== "undefined") cleanups.push(stop);
}

// 美化若用 !important 强改普通文字颜色（span、p、div 等），面板文字会跟着变、看不清。
// 打开或换主题时用探针比对：被改了就启用 cw-guard，把面板自己的字色规则加上 !important 再套一层。
function hostForcesText(root) {
  const want = "rgb(1, 2, 3)";
  const probe = document.createElement("cw-probe");
  probe.setAttribute("style", `position:absolute!important;visibility:hidden!important;pointer-events:none!important;color:${want}!important;-webkit-text-fill-color:${want}!important`);
  probe.innerHTML = "<span></span><p></p><b></b><strong></strong><small></small><em></em><label></label><div></div><li></li><summary></summary><h3></h3><h4></h4><code></code>";
  root.append(probe);
  const forced = [...probe.children].some((el) => {
    const cs = getComputedStyle(el);
    return cs.color !== want || (cs.webkitTextFillColor && cs.webkitTextFillColor !== want);
  });
  probe.remove();
  return forced;
}

function guardRules() {
  if (document.getElementById("cw-guard-style")) return;
  const sheet = document.getElementById("cw-style")?.sheet;
  if (!sheet) return;
  const out = ["#cw-root.cw-guard :where(b, strong, p, span, label, small, em, i, details, summary, li, dt, dd, div, h1, h2, h3, h4, h5, a, code, pre, td, th, article, header, section) { color: inherit !important; -webkit-text-fill-color: currentColor !important; }"];
  const walk = (rules, wrap) => {
    for (const rule of rules) {
      const at = rule instanceof CSSMediaRule ? "@media" : typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule ? "@supports" : "";
      if (at) { walk(rule.cssRules, (t) => wrap(`${at} ${rule.conditionText} { ${t} }`)); continue; }
      const sel = rule.selectorText, color = rule.style?.getPropertyValue("color");
      if (!sel || !color || !sel.includes("#cw-root")) continue;
      const fill = rule.style.getPropertyValue("-webkit-text-fill-color") || "currentColor";
      out.push(wrap(`${sel.replaceAll("#cw-root", "#cw-root.cw-guard")} { color: ${color} !important; -webkit-text-fill-color: ${fill} !important; }`));
    }
  };
  walk(sheet.cssRules, (t) => t);
  const style = document.createElement("style");
  style.id = "cw-guard-style";
  style.textContent = out.join("\n");
  document.head.append(style);
  if (typeof cleanups !== "undefined") cleanups.push(() => style.remove());
}

var bgUrl = null;

// 2.5.8 「跟随系统」是配色标题右边的开关（followSystem），不再是一张配色卡：
// 开着时系统深色用夜雾，浅色用选中的配色。系统切换时由 watchTheme 里的 prefers-color-scheme 监听重新上色。
// 2.3.7～2.5.7 存的是 theme: "system"，浅色配色记在 themeLight，这里换成新写法。
function themePrefs() {
  const s = settings();
  const valid = (id) => THEMES.some((t) => t.id === id);
  if (s.theme === "system") {
    s.followSystem = true;
    s.theme = valid(s.themeLight) && s.themeLight !== "night" ? s.themeLight : "follow";
    delete s.themeLight;
  }
  // 1.4.0 去掉了薰衣草、海盐，2.3.8 去掉了春芽，选过的回到默认
  return { theme: valid(s.theme) ? s.theme : "atelier", followSystem: s.followSystem === true };
}

function systemDark() {
  return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function effectiveTheme() {
  const { theme, followSystem } = themePrefs();
  return followSystem && systemDark() ? "night" : theme;
}

function applyTheme(root) {
  if (!root) return;
  watchTheme(root);
  root.classList.remove("cw-guard");
  if (hostForcesText(root)) {
    guardRules();
    root.classList.add("cw-guard");
  }
  const id = effectiveTheme();
  root.dataset.theme = id;
  root.dataset.fs = fontSizePref();
  const theme = THEMES.find((t) => t.id === id);
  root.classList.toggle("cw-painted", !!theme?.paint);
  root.classList.toggle("cw-glass", !!theme?.glass);
  const host = getComputedStyle(document.body);
  const hostColors = ["--SmartThemeBlurTintColor", "--SmartThemeBodyColor", "--SmartThemeQuoteColor", "--SmartThemeEmColor", "--SmartThemeBorderColor"].map((key) => host.getPropertyValue(key).trim());
  const signature = JSON.stringify([id, ...(id === "follow" ? hostColors : [])]);
  if (root._paThemeSignature === signature) return applyBackground(root);
  root._paThemeSignature = signature;
  for (const key of ["text", "muted", "accent", "on-accent", "control", "check", "warn", "warn-hue", "ok", "line"]) root.style.removeProperty(`--cw-${key}`);
  if (id !== "follow") {
    root.style.removeProperty("--cw-bg");
    root.style.removeProperty("--cw-input");
  } else {
    const tint = readColor(hostColors[0]) || { r: 28, g: 26, b: 30 };
    root.style.setProperty("--cw-bg", themeRgb(tint));
    const light = themeLuminance(tint) > .179;
    root.style.setProperty("--cw-input", light ? "rgba(255, 255, 255, .72)" : "rgba(0, 0, 0, .2)");
  }
  const cs = getComputedStyle(root);
  const color = (key, fallback) => readColor(cs.getPropertyValue(`--cw-${key}`).trim()) || fallback;
  const base = color("bg", { r: 28, g: 26, b: 30 });
  // 2.5.7 深色底：样式表据此把「跟随酒馆主题」的卡片、选中底色换成固定的淡层（见 style.css 的 .cw-dark），要在下面算表面颜色之前设好
  root.classList.toggle("cw-dark", themeLuminance(base) <= .179);
  const requestedText = color("text", { r: 230, g: 225, b: 216 }), requestedAccent = color("accent", { r: 224, g: 162, b: 74 });
  const requestedWarn = color("warn", { r: 224, g: 120, b: 74 });
  const surfaceColors = () => {
    const layer = Object.fromEntries(["surface", "raised", "input", "accent-soft"].map(key => [key, color(key, { ...base, a: 0 })]));
    const panels = [base, themeMix(layer.surface, base), themeMix(layer.raised, base), themeMix(layer.raised, themeMix(layer.surface, base))];
    const selected = panels.map(bg => themeMix(layer["accent-soft"], bg));
    // 真实预览里选中方式位于卡片内，输入框/正文片段又位于其中。
    return [...panels, ...selected, ...[...panels, ...selected].map(bg => themeMix(layer.input, bg))];
  };
  let surfaces, text, accent, previous = "";
  // 卡片/选中底色本身依赖 text/thread；纠正后重读实际表面，避免沿用旧浅字的表面。
  // 仅主题签名改变时运行，按 RGB 取整后的结果收敛，最多八轮。
  for (let i = 0; i < 8; i++) {
    surfaces = surfaceColors();
    text = readableThemeColor(requestedText, surfaces, 4.5);
    accent = readableThemeColor(requestedAccent, surfaces, 4.5);
    const signature = themeRgb(text) + themeRgb(accent);
    if (signature === previous) break;
    previous = signature;
    root.style.setProperty("--cw-text", themeRgb(text));
    root.style.setProperty("--cw-accent", themeRgb(accent));
  }
  surfaces = surfaceColors();
  const ink = themeContrast(accent, { r: 255, g: 255, b: 255 }) >= themeContrast(accent, { r: 0, g: 0, b: 0 }) ? "#ffffff" : "#000000";
  for (const [key, value] of Object.entries({
    text, accent,
    muted: readableThemeColor(themeMix(text, base, .68), surfaces, 4.5),
    control: readableThemeColor(themeMix(text, base, .6), surfaces, 3),
    warn: readableThemeColor(requestedWarn, surfaces, 4.5),
    ok: readableThemeColor(color("ok", { r: 111, g: 179, b: 138 }), surfaces, 4.5)
  })) root.style.setProperty(`--cw-${key}`, themeRgb(value));
  // 跟随酒馆时，酒馆的边框色多是半透明黑或白：换成不透明的浅一级线色，面板边框只作轻分隔
  if (id === "follow") root.style.setProperty("--cw-line", themeRgb(themeMix(text, base, .14)));
  // 2.5.0 警告色为了字够清楚会被调亮、调暗（深色主题里接近白色），浅色底用主题原本的色相
  root.style.setProperty("--cw-warn-hue", themeRgb(requestedWarn));
  root.style.setProperty("--cw-on-accent", ink);
  root.style.setProperty("--cw-check", `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.3 2.3 4.7-5' fill='none' stroke='${ink.replace("#", "%23")}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`);
  root.style.colorScheme = themeLuminance(base) > .179 ? "light" : "dark";
  applyBackground(root);
}

// 自定义背景图：图片上盖一层主题底色，浓度可调，保证文字清楚
async function applyBackground(root) {
  const bg = settings().bg || {};
  if (!bg.on) {
    root.classList.remove("cw-has-bg");
    return;
  }
  try {
    if (!bgUrl) {
      const blob = await assetGet("bg");
      if (!blob) {
        root.classList.remove("cw-has-bg");
        return;
      }
      bgUrl = URL.createObjectURL(blob);
    }
    const tint = readColor(getComputedStyle(root).getPropertyValue("--cw-bg").trim()) || { r: 240, g: 240, b: 240 };
    const veil = Math.min(0.9, Math.max(0, bg.veil ?? 0.55));
    root.style.setProperty("--cw-bg-img", `url("${bgUrl}")`);
    root.style.setProperty("--cw-bg-veil", `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${veil})`);
    root.classList.add("cw-has-bg");
  } catch (e) {
    console.warn("[焦香鸡翅] 背景图读取失败", e);
    root.classList.remove("cw-has-bg");
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

// 1.5.0 文字大小：小 / 标准 / 大。每台设备单独记（手机和平板常常想要不同的大小），存在本浏览器
var FS_KEY = "presetAtelier:fontSize";

function fontSizePref() {
  try {
    return localStorage.getItem(FS_KEY) || "m";
  } catch {
    return "m";
  }
}
