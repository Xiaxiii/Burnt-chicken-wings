// 悬浮球：默认关闭；扩展页设置框和「更多 → 外观」都能开关；点一下打开，拖动后贴边并记住位置。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForSelector("#pa-settings");
const ok = (m) => console.log("✓", m);
const S = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier);

assert.equal(await page.$("#pa-ball"), null, "默认没有悬浮球");
assert.equal(await page.locator("[data-opt=floatBall]").isChecked(), false);
await page.$eval("[data-opt=floatBall]", (x) => x.click());
assert.ok(await page.$("#pa-ball"), "勾选后出现");
assert.equal((await S()).floatBall, true);
ok("扩展页设置框里开启");

// 酒馆在 html 上听 mousedown/touchstart 收起抽屉；拖球、点球不能传到那里
await page.evaluate(() => { window.__htmlDown = 0; document.documentElement.addEventListener("mousedown", () => window.__htmlDown++); document.documentElement.addEventListener("touchstart", () => window.__htmlDown++); });
// 拖到左半边，松手贴左边
let r = await page.$eval("#pa-ball", (b) => b.getBoundingClientRect().toJSON());
await page.mouse.move(r.x + 22, r.y + 22);
await page.mouse.down();
await page.mouse.move(120, 300, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
r = await page.$eval("#pa-ball", (b) => b.getBoundingClientRect().toJSON());
assert.equal(Math.round(r.x), 8, "贴到左边");
assert.equal((await S()).floatBallPos.x, 0);
assert.ok(await page.$eval("#pa-root", (x) => x.hidden).catch(() => true), "拖动不算打开");
assert.equal(await page.evaluate(() => window.__htmlDown), 0, "不触发酒馆收起抽屉");
ok("拖动后贴边并记住位置，不收起酒馆面板");

await page.click("#pa-ball"); await page.waitForTimeout(400);
assert.equal(await page.$eval("#pa-root", (x) => x.hidden), false, "点一下打开");
assert.equal(await page.$eval("#pa-ball", (b) => getComputedStyle(b).display), "none", "面板打开时隐藏");
assert.equal(await page.evaluate(() => window.__htmlDown), 0, "点球不触发酒馆收起抽屉");
ok("点一下打开面板");

await page.evaluate(() => window.__presetAtelier.open("more", "look")); await page.waitForTimeout(300);
const look = page.locator("[data-mp=look] [data-o=floatball]");
assert.ok(await page.$eval("[data-mp=look] .pa-scroll", (x) => x.firstElementChild.matches(".pa-ballrow")), "在配色上面");
assert.equal(await look.isChecked(), true);
await look.uncheck(); await page.waitForTimeout(100);
assert.equal(await page.$("#pa-ball"), null, "外观里关闭");
assert.equal(await page.locator("[data-opt=floatBall]").isChecked(), false, "设置框同步");
ok("「更多 → 外观」里关闭，设置框同步");

assert.deepEqual(errs, []);
console.log("悬浮球检查全部通过");
await browser.close();
