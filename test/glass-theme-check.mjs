// 毛玻璃配色（芽体、菌落）：顶栏、页签、侧栏是毛玻璃，列表不做实时模糊，正文对比度足够；旧配色名回落到默认工作台
import assert from "node:assert";
import { start, open, P, SHOTS } from "./helpers.mjs";
const { page, done } = await start({ width: 390, height: 844, mobile: true });
await open(page, "look");
for (const id of ["bud", "colony"]) {
  await page.click(`[data-theme-id="${id}"]`); await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + `g-${id}-look.png` });
  await open(page, "preset");
  await page.waitForSelector(`${P("preset")} .cw-group`);
  await page.screenshot({ path: SHOTS + `g-${id}-preset.png` });
  const r = await page.evaluate(() => {
    const root = document.getElementById("cw-root");
    const bf = (sel) => { const el = root.querySelector(sel); const cs = getComputedStyle(el); return cs.backdropFilter || cs.webkitBackdropFilter || "none"; };
    const lum = (rgb) => rgb.map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
    const rgb = (v) => { v = v.trim(); return v[0] === "#" ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) : v.match(/[\d.]+/g).slice(0, 3).map(Number); };
    const cs = getComputedStyle(root);
    const a = lum(rgb(cs.getPropertyValue("--cw-text"))), b = lum(rgb(cs.getPropertyValue("--cw-bg")));
    return { glass: root.classList.contains("cw-glass"), theme: root.dataset.theme, top: bf(".cw-top"), tabs: bf(".cw-tabbar"), group: bf(".cw-group"), appBg: getComputedStyle(root.querySelector(".cw-app")).backgroundImage.split("gradient").length - 1, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  });
  assert.equal(r.theme, id);
  assert.ok(r.glass, "毛玻璃配色要加 cw-glass");
  assert.match(r.top, /blur/, "顶栏是毛玻璃");
  assert.match(r.tabs, /blur/, "页签栏是毛玻璃");
  assert.equal(r.group, "none", "列表里的分组不做实时模糊");
  assert.ok(r.appBg > 3, "油画底 + 光斑");
  assert.ok(r.contrast >= 4.5, `正文对比度 ${r.contrast}`);
  await open(page, "look");
}
await page.click('[data-theme-id="dusk"]'); await page.waitForTimeout(200);
assert.ok(!(await page.evaluate(() => document.getElementById("cw-root").classList.contains("cw-glass"))));
assert.equal(await page.locator('[data-theme-id="matcha"]').count(), 0);
assert.equal(await page.evaluate(() => {
  window.SillyTavern.getContext().extensionSettings.presetAtelier.theme = "matcha";
  window.__presetAtelier.open("preset");
  return document.getElementById("cw-root").dataset.theme;
}), "atelier");
await done("毛玻璃配色检查全部通过");
