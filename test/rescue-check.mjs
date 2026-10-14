// 后台中断补救的检查。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const exe = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.waitForTimeout(1800);
const emit = (ev, ...a) => page.evaluate(([ev, a]) => window.SillyTavern.getContext().eventSource.emit(ev, ...a), [ev, a]);
const setHidden = (h) => page.evaluate((h) => { Object.defineProperty(document, "hidden", { get: () => h, configurable: true }); Object.defineProperty(document, "visibilityState", { get: () => h ? "hidden" : "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }, h);
const bar = () => page.$eval("#pa-rescue", (x) => x.innerText).catch(() => null);
assert.equal(await bar(), null, "打开时没有提示");
// 1) 前台生成完：不提示
await emit("generation_started", "normal", {}, false); await emit("generation_ended"); await page.waitForTimeout(900);
assert.equal(await bar(), null);
// 2a) 在后台安稳生成完、回复已经到了：不提示
await emit("generation_started", "normal", {}, false); await setHidden(true); await emit("generation_ended"); await page.waitForTimeout(900);
assert.equal(await bar(), null, "后台时不弹");
await setHidden(false); await page.waitForTimeout(900);
assert.equal(await bar(), null, "回复完整收到时不提示");
// 2b) 切到后台，回到前台后很快才结束（连接被断、回来才收尾）：提示可能截断
await emit("generation_started", "normal", {}, false); await setHidden(true); await setHidden(false); await emit("generation_ended"); await page.waitForTimeout(900);
const t = await bar();
assert.match(t, /可能被截断/); assert.match(t, /续写/); assert.match(t, /重新生成/);
await page.screenshot({ path: S + "r-1-bar.png" });
await page.click("#pa-rescue [data-i='0']"); await page.waitForTimeout(200);
assert.deepEqual(await page.evaluate(() => window.__gen), ["continue"]);
assert.equal(await bar(), null);
// 3) 自己点停止：不提示
await emit("generation_started", "normal", {}, false); await setHidden(true); await emit("generation_stopped"); await setHidden(false); await page.waitForTimeout(900);
assert.equal(await bar(), null);
// 4) dryRun（计算 token）不算
await emit("generation_started", "normal", {}, true); await setHidden(true); await emit("generation_ended"); await setHidden(false); await page.waitForTimeout(900);
assert.equal(await bar(), null);
// 5) 生成中页面被重新加载
await emit("generation_started", "normal", {}, false);
await page.evaluate(() => { const c = window.SillyTavern.getContext(); });
await page.reload();
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => { window.SillyTavern.getContext().chat.push({ is_user: true, mes: "再来" }); });
await page.waitForTimeout(2200);
const t2 = await bar();
assert.match(t2, /页面被重新加载/); assert.match(t2, /生成回复/);
await page.click("#pa-rescue [data-i='0']"); await page.waitForTimeout(200);
assert.deepEqual(await page.evaluate(() => window.__gen), ["normal"]);
// 关掉开关后不提示
await page.evaluate(() => { window.SillyTavern.getContext().extensionSettings.presetAtelier.rescue = false; });
await emit("generation_started", "normal", {}, false); await setHidden(true); await emit("generation_ended"); await setHidden(false); await page.waitForTimeout(900);
assert.equal(await bar(), null);
assert.deepEqual(errs, []);
console.log("后台中断补救检查全部通过");
await browser.close();
