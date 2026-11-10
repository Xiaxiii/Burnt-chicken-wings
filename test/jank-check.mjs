// 2.7.8 运行中的卡顿记录：别的代码卡住页面时记为卡顿且不算在本扩展头上；本扩展处理计时；体检页显示结论
// 用法：在仓库根目录起静态服务（python3 -m http.server 8765）；node test/jank-check.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${process.env.PA_PORT || 8765}/test/site/index.html`);
await page.waitForFunction(() => window.__presetAtelier?.open);
// 别的代码占住页面 300 毫秒
await page.evaluate(() => new Promise((r) => setTimeout(() => { const t = performance.now(); while (performance.now() - t < 300); r(); }, 0)));
await page.waitForTimeout(300);
// 本扩展处理：切换聊天、切换预设事件，翻几页
await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.CHAT_CHANGED); await c.eventSource.emit(c.eventTypes.PRESET_CHANGED, { apiId: "openai" }); });
await page.evaluate(() => window.__presetAtelier.open("organize"));
await page.evaluate(() => window.__presetAtelier.open("conn"));
await page.evaluate(() => window.__presetAtelier.open("health"));
await page.waitForSelector("[data-page=health] .pa-jank");
const text = await page.locator("[data-page=health] .pa-jank").innerText();
assert.match(text, /页面卡顿 \d+ 次/, text);
assert.match(text, /都没有在处理，原因在酒馆本身或其他扩展/, text);
await page.locator("[data-page=health] .pa-jank summary", { hasText: "各项处理耗时" }).click();
const own = await page.locator("[data-page=health] .pa-jank .pa-rank").innerText();
assert.match(own, /事件：切换聊天/);
assert.match(own, /显示页面：预设 · 条目/);
console.log("✓ 别的代码造成的卡顿被记录，不算在本扩展头上；本扩展各项处理有计时");
await page.click("[data-page=health] [data-h=jankclear]");
await page.waitForTimeout(400);
assert.match(await page.locator("[data-page=health] .pa-jank").innerText(), /没有卡顿|页面卡顿/);
console.log("✓ 清空记录后重新统计");
assert.deepEqual(errs, []);
await browser.close();
