// 各种外壳的适配：面板高度按实际可见高度；网页没盖住状态栏、底部横条时不重复留安全区；底部页签始终在可见范围内
import assert from "node:assert";
import { chromium } from "playwright";
import { SITE, ok } from "./helpers.mjs";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
async function run({ w, h, screenH, insetT, insetB }) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  await page.addInitScript(([sw, sh]) => { Object.defineProperty(window.screen, "width", { get: () => sw }); Object.defineProperty(window.screen, "height", { get: () => sh }); }, [w, screenH]);
  await page.goto(SITE);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  // 模拟系统报告的安全区
  await page.addStyleTag({ content: `#cw-safe-probe{padding-top:${insetT}px!important;padding-bottom:${insetB}px!important}` });
  await page.evaluate(() => window.__presetAtelier.open("preset")); await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const root = document.getElementById("cw-root"), cs = getComputedStyle(root);
    const bar = root.querySelector(".cw-tabbar").getBoundingClientRect(), app = root.querySelector(".cw-app").getBoundingClientRect();
    return { sat: cs.getPropertyValue("--cw-sat").trim(), sab: cs.getPropertyValue("--cw-sab").trim(), appH: app.height, barBottom: bar.bottom, vh: innerHeight };
  });
  await page.close();
  return r;
}
// 1) App 内嵌网页：网页在状态栏下面、底部横条上面，系统仍报安全区 → 不再留白
let r = await run({ w: 390, h: 763, screenH: 844, insetT: 47, insetB: 34 });
assert.equal(r.sat, "0px"); assert.equal(r.sab, "0px");
assert.ok(r.barBottom <= r.vh + 0.5, `页签在可见范围内 ${r.barBottom} <= ${r.vh}`);
assert.equal(Math.round(r.appH), r.vh);
ok("App 内嵌网页：不重复留安全区，页签可见");
// 2) 全屏网页（PWA、全面屏）：保留安全区
r = await run({ w: 390, h: 844, screenH: 844, insetT: 47, insetB: 34 });
assert.equal(r.sat, "47px"); assert.equal(r.sab, "34px");
assert.ok(r.barBottom <= r.vh + 0.5);
ok("全屏网页：保留安全区");
// 3) 只在状态栏下面：顶部不留，底部保留
r = await run({ w: 390, h: 797, screenH: 844, insetT: 47, insetB: 34 });
assert.equal(r.sat, "0px"); assert.equal(r.sab, "34px");
ok("顶部在状态栏下：只保留底部安全区");
// 4) Safari：顶部不报安全区，底部横条保留
r = await run({ w: 390, h: 750, screenH: 844, insetT: 0, insetB: 34 });
assert.equal(r.sat, "0px"); assert.equal(r.sab, "34px");
r = await run({ w: 820, h: 1100, screenH: 1180, insetT: 0, insetB: 20 });
assert.equal(r.sab, "20px");
ok("Safari 浏览器：保留底部横条位置");
// 5) iPad App 内嵌网页
r = await run({ w: 820, h: 1136, screenH: 1180, insetT: 24, insetB: 20 });
assert.equal(r.sat, "0px"); assert.equal(r.sab, "0px");
ok("iPad App 内嵌网页：不重复留白");
// 6) 电脑：高度等于可见高度
r = await run({ w: 1024, h: 768, screenH: 1366, insetT: 0, insetB: 0 });
assert.equal(Math.round(r.appH), r.vh);
ok("电脑：高度等于可见高度");
console.log("适配检查通过");
await browser.close();
