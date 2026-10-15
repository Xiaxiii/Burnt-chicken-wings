// 缝合页 🔍：点放大镜直接弹出搜索窗，边打边出结果；来源点结果＝选中（窗口不关）；目标点结果＝定缝合位置；搜过的词记着
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => window.__presetAtelier.open("suture"));
await page.waitForTimeout(600);
const ok = (m) => console.log("✓", m);

// 来源：取一条条目名的前两个字来搜
const name = (await page.locator(".pa-src-list .pa-row .pa-name").first().innerText()).trim();
const kw = [...name].filter((c) => /[一-龥a-zA-Z]/.test(c)).slice(0, 2).join("");
await page.click("[data-st=srcsearch]"); await page.waitForTimeout(250);
assert.ok(await page.locator(".pa-sheet .pa-ss-q").isVisible(), "点放大镜直接弹出搜索窗");
assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("pa-ss-q")), true, "搜索框自动获得焦点");
await page.fill(".pa-sheet .pa-ss-q", kw); await page.waitForTimeout(150);
const n = await page.locator(".pa-ss-item").count();
assert.ok(n >= 1, "边打边出结果");
assert.match(await page.locator(".pa-ss-hint").innerText(), /名称里有/);
await page.locator(".pa-ss-item").first().click(); await page.waitForTimeout(150);
assert.ok(await page.locator(".pa-sheet .pa-ss-q").isVisible(), "来源点结果后窗口不关");
assert.ok(await page.locator(".pa-ss-item").first().evaluate((x) => x.classList.contains("on")), "点了就选中");
await page.screenshot({ path: S + "ss-1-src.png" });
await page.click(".pa-sheet-x"); await page.waitForTimeout(300);
assert.match(await page.locator(".pa-picked-n").innerText(), /已选 1 条/);
ok("来源：弹出就能搜，点结果选中，窗口不关");

// 再点放大镜：上次的词还在，结果直接显示
await page.click("[data-st=srcsearch]"); await page.waitForTimeout(250);
assert.equal(await page.inputValue(".pa-sheet .pa-ss-q"), kw, "搜过的词记着");
assert.equal(await page.locator(".pa-ss-item").count(), n, "直接显示上次的结果");
await page.click(".pa-sheet-x"); await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sutureQuery.qSrc), kw, "存进设置，刷新后也在");
ok("再点放大镜：上次的词和结果还在");

// 目标：点结果＝缝合位置定在它后面
const tname = (await page.locator(".pa-dst-list .pa-row .pa-name, .pa-dst-list .pa-ghead b").first().innerText()).trim();
const tkw = [...tname].filter((c) => /[一-龥a-zA-Z]/.test(c)).slice(0, 2).join("");
await page.click("[data-st=dstsearch]"); await page.waitForTimeout(250);
await page.fill(".pa-sheet .pa-ss-q", tkw); await page.waitForTimeout(150);
const pickName = (await page.locator(".pa-ss-item b").first().innerText()).trim();
await page.locator(".pa-ss-item").first().click(); await page.waitForTimeout(400);
assert.equal(await page.locator(".pa-sheet .pa-ss-q").count(), 0, "目标点结果后窗口关掉");
assert.match(await page.locator(".pa-where").innerText(), new RegExp(pickName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
await page.screenshot({ path: S + "ss-2-dst.png" });
ok("目标：点结果，缝合位置定在它后面");

// 粘贴来源没有放大镜
await page.click("[data-st=srctype]"); await page.waitForTimeout(200);
await page.click(".pa-npick-item >> text=粘贴"); await page.waitForTimeout(300);
assert.ok(await page.locator("[data-st=srcsearch]").isHidden());
ok("粘贴来源不显示放大镜");

assert.deepEqual(errs, []);
console.log("缝合搜索检查通过");
await browser.close();
