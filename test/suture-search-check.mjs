// 缝合页 🔍：点放大镜弹出输入框，边打边在「从」「到」列表里筛出来（和整理页一样）；搜的词记着，「✕ 清除」恢复
import { chromium } from "playwright";
import assert from "node:assert";
import "./choose.mjs";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => window.__presetAtelier.open("stitch"));
await page.waitForTimeout(600);
const ok = (m) => console.log("✓", m);
const kwOf = (t) => [...t].filter((c) => /[一-龥a-zA-Z]/.test(c)).slice(0, 2).join("");

// 来源：搜一个条目名（在折叠的组里），列表里直接筛出来并展开
const name = (await page.evaluate(() => {
  const d = window.__mock.presets[0];
  return d.prompts.find((p) => p.name && /[一-龥]{2}/.test(p.name) && !p.marker).name;
}));
const kw = kwOf(name);
const before = await page.locator(".cw-pane-src .cw-list .cw-row").count();
// 3.0：搜索框就在「从」「到」两栏顶上，边打边筛，点一下就能打字
await page.click("[data-q=src]"); await page.waitForTimeout(250);
assert.equal(await page.evaluate(() => document.activeElement?.dataset?.q === "src"), true, "点了就能打字");
await page.fill("[data-q=src]", kw); await page.waitForTimeout(400);
assert.match(await page.locator(".cw-pane-src .cw-list .cw-qsum").innerText(), /匹配/, "边打边在列表里筛");
const rows = page.locator(".cw-pane-src .cw-list .cw-row");
assert.ok(await rows.count() >= 1 && (await rows.count()) !== before);
assert.ok(await page.locator('.cw-search[data-side="src"]').evaluate((x) => x.classList.contains("has-q")), "搜索框标出正在搜");
await rows.first().click(); await page.waitForTimeout(200);
assert.match(await page.locator(".cw-picked-n").innerText(), /已选 1 条/, "筛出来的条目直接点选");
await page.screenshot({ path: S + "ss-1-src.png" });
ok("来源：列表里直接筛出来，点了就选");
assert.equal(await page.inputValue("[data-q=src]"), kw);
assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sutureQuery.qSrc), kw);
ok("搜的词记着");

// 目标：同样筛出来，点一条定缝合位置
await page.fill("[data-q=dst]", kw); await page.waitForTimeout(400);
const drow = page.locator(".cw-pane-dst .cw-list .cw-row").first();
const dn = (await drow.locator(".cw-row-name").innerText()).trim();
await drow.click(); await page.waitForTimeout(300);
assert.ok((await page.locator(".cw-where").innerText()).includes(dn));
await page.screenshot({ path: S + "ss-2-dst.png" });
ok("目标：列表里筛出来，点一条定缝合位置");

// 清除：恢复全部
await page.click("[data-act=qclear-src]"); await page.waitForTimeout(300);
assert.equal(await page.locator(".cw-pane-src .cw-list .cw-qsum").count(), 0);
assert.equal(await page.locator(".cw-pane-src .cw-list .cw-row").count(), before, "清除后恢复原样");
ok("✕ 清除后恢复全部");

assert.deepEqual(errs, []);
console.log("缝合搜索检查通过");
await browser.close();
