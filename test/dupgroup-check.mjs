// 双层分组提示与修复。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => {
  const P = (id, name) => ({ identifier: id, name, content: name + "的内容", role: "system" });
  const p = { prompts: [P("a", "甲"), P("b", "乙"), P("c", "丙")], prompt_order: [{ character_id: 100001, order: ["a", "b", "c"].map((identifier) => ({ identifier, enabled: true })) }],
    extensions: { baibaiToolkit: { presetPromptGroups: { version: 1, groups: [{ id: "g1", name: "文风选择", order: 0 }], prompts: { a: { groupId: "g1" }, b: { groupId: "g1" } } } },
      entryGrouping: [{ id: "x1", name: "文风选择", startIdentifier: "a", endIdentifier: "b", mode: "inclusive" }] } };
  window.__mock.names.push("双层"); window.__mock.presets.push(p);
  window.__presetAtelier.open("organize");
});
await page.waitForTimeout(300);
await page.selectOption(".pa-picker-slot select, .pa-picker select", "双层").catch(async () => { await page.selectOption("select", "双层"); });
await page.waitForTimeout(400);
assert.match(await page.$eval(".pa-list", (x) => x.innerText), /分组存了两份/);
await page.screenshot({ path: S + "d-1-banner.png" });
await page.click("[data-dup=fix]"); await page.waitForTimeout(1200);
assert.ok(!(await page.$("[data-dup=fix]")), "修复后提示消失");
const ext = await page.evaluate(() => window.__mock.presets[window.__mock.names.indexOf("双层")].extensions);
assert.ok(!ext.entryGrouping, "保存后没有重复的 entryGrouping");
assert.equal(ext.baibaiToolkit.presetPromptGroups.groups.length, 1, "百宝箱分组保留");
assert.deepEqual(errs, []);
console.log("双层分组检查通过");
await browser.close();
