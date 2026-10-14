// 清理页其他几栏（扩展数据、角色卡、世界书、本地备份）+ 日落海岸配色。用法同 clean-check.mjs
import { chromium } from "playwright";
import assert from "node:assert";
const S = new URL("./shots/", import.meta.url).pathname;
const exe = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
const deleted = [];
await page.route("**/api/extensions/discover", (r) => r.fulfill({ json: [{ type: "system", name: "regex" }, { type: "local", name: "third-party/st-goodext" }, { type: "local", name: "third-party/Burnt-chicken-wings" }] }));
await page.route("**/scripts/extensions/third-party/st-goodext/manifest.json", (r) => r.fulfill({ json: { display_name: "好扩展", js: "index.js" } }));
await page.route("**/scripts/extensions/third-party/st-goodext/index.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'import { x } from "./src/core.js"; export const a = 1;' }));
await page.route("**/scripts/extensions/third-party/st-goodext/src/core.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'extension_settings["myHiddenKey"] = {}; extension_settings.anotherKey = 1;' }));
await page.route("**/scripts/extensions/regex/manifest.json", (r) => r.fulfill({ json: { display_name: "Regex", js: "index.js" } }));
await page.route("**/scripts/extensions/regex/index.js", (r) => r.fulfill({ contentType: "text/javascript", body: "extension_settings.regex = [];" }));
await page.route("**/scripts/extensions/third-party/Burnt-chicken-wings/manifest.json", (r) => r.fulfill({ json: { display_name: "焦香鸡翅", js: "index.js" } }));
await page.route("**/scripts/extensions/third-party/Burnt-chicken-wings/index.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'var KEY = "presetAtelier";' }));
await page.route("**/api/characters/delete", (r) => { deleted.push(r.request().postDataJSON()); r.fulfill({ status: 200, body: "" }); });
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => {
  const c = window.SillyTavern.getContext();
  c.getRequestHeaders = () => ({ "Content-Type": "application/json" });
  Object.assign(c.extensionSettings, { regex: [1, 2, 3], myHiddenKey: { a: "x".repeat(5000) }, anotherKey: 1, oldUninstalled: { big: "y".repeat(40000) }, goodext: { v: 1 }, disabledExtensions: [] });
  c.characters = [
    { name: "姜泰温", avatar: "jiang.png", shallow: true, data_size: 5000, date_last_chat: Date.now() - 864e5, chat_size: 120000 },
    { name: "姜泰温", avatar: "jiang1.png", shallow: true, data_size: 5000, date_last_chat: 0 },
    { name: "Julian", avatar: "julian.png", shallow: true, data_size: 3000 }
  ];
  c.characterId = 0;
  c.getCharacters = async () => { c.characters = c.characters.filter((x) => !window.__delChars?.includes(x.avatar)); };
  window.__presetAtelier.open("more");
});
await page.waitForTimeout(300);
await page.click('[data-m="clean"]'); await page.waitForTimeout(300);
// 扩展数据
await page.click('[data-kind="ext"]'); await page.waitForTimeout(600);
let txt = await page.$eval(".pa-clean-other", (x) => x.innerText);
assert.match(txt, /oldUninstalled[\s\S]*可能已卸载/);
assert.match(txt, /regex[\s\S]*酒馆内置/);
assert.match(txt, /goodext[\s\S]*推测属于：好扩展/);
assert.match(txt, /myHiddenKey[\s\S]*可能已卸载/);
await page.click('[data-x="scan"]');
await page.waitForFunction(() => document.querySelector(".pa-clean-other")?.innerText.includes("重新检测"), null, { timeout: 10000 });
txt = await page.$eval(".pa-clean-other", (x) => x.innerText);
assert.match(txt, /myHiddenKey[\s\S]*检测：好扩展在用/, "跟进相对 import 后找到使用者");
assert.match(txt, /oldUninstalled[\s\S]*检测：已安装扩展的代码里没找到它，疑似卸载残留，删除前请核对/);
assert.match(txt, /勾选 1 项疑似残留/);
assert.match(txt, /goodext[\s\S]*名称像「好扩展」，请确认/);
assert.ok(await page.$eval('.pa-clean-other input[data-k="presetAtelier"]', (x) => x.disabled));
await page.screenshot({ path: S + "m-1-ext.png" });
await page.click('[data-x="pickorphans"]'); await page.waitForTimeout(200);
assert.ok(await page.$eval('.pa-clean-other input[data-k="oldUninstalled"]', (x) => x.checked), "疑似残留被勾选");
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
const dl = page.waitForEvent("download");
await page.click(".pa-sheet .pa-btn-danger");
assert.match((await dl).suggestedFilename(), /^extension-data-backup-\d+\.json$/);
await page.waitForTimeout(200);
// 下载只是交给浏览器，没确认文件存好之前不删（FIX-02/03）
assert.equal(await page.$eval(".pa-sheet-mask:last-child .pa-sheet-head b", (x) => x.textContent), "确认备份已保存");
assert.ok(await page.evaluate(() => "oldUninstalled" in window.SillyTavern.getContext().extensionSettings), "确认前不删除");
await page.click(".pa-sheet-mask:last-child >> text=取消删除"); await page.waitForTimeout(250);
assert.ok(await page.evaluate(() => "oldUninstalled" in window.SillyTavern.getContext().extensionSettings), "取消后不删除");
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
const dlAgain = page.waitForEvent("download");
await page.click(".pa-sheet .pa-btn-danger");
await dlAgain; await page.waitForTimeout(200);
await page.click(".pa-sheet-mask:last-child .pa-btn-danger"); await page.waitForTimeout(250);
assert.ok(!(await page.evaluate(() => "oldUninstalled" in window.SillyTavern.getContext().extensionSettings)));
// 角色卡
await page.click('[data-kind="char"]'); await page.waitForTimeout(300);
txt = await page.$eval(".pa-clean-other", (x) => x.innerText);
assert.match(txt, /1 组同名/); assert.match(txt, /未加载完整内容，无法比较/);
assert.ok(await page.$eval('.pa-clean-other input[data-k="jiang.png"]', (x) => x.disabled), "正在聊天的不能勾选");
await page.screenshot({ path: S + "m-2-char.png" });
await page.click('.pa-clean-other input[data-k="jiang1.png"]'); await page.waitForTimeout(100);
await page.evaluate(() => { window.__delChars = ["jiang1.png"]; });
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
await page.click(".pa-sheet .pa-btn-danger"); await page.waitForTimeout(500);
assert.deepEqual(deleted, [{ avatar_url: "jiang1.png", delete_chats: false }]);
assert.match(await page.$eval(".pa-clean-other", (x) => x.innerText), /没有同名的角色卡/);
// 世界书：复制一本相同的、加一本空的
await page.evaluate(() => { const s = globalThis.__wiStore; s["示例世界书-副本"] = structuredClone(s["示例世界书"]); s["空的"] = { entries: {} }; });
await page.evaluate(async () => { const m = await import("/test/site/scripts/world-info.js"); m.world_names.push("示例世界书-副本", "空的"); });
await page.click('[data-kind="world"]'); await page.waitForTimeout(200);
await page.click('[data-x="scan"]');
await page.waitForFunction(() => document.querySelector(".pa-clean-other")?.innerText.includes("重新比对"), null, { timeout: 10000 });
txt = await page.$eval(".pa-clean-other", (x) => x.innerText);
assert.match(txt, /条目完全相同（1 组）/); assert.match(txt, /全局启用/); assert.match(txt, /没有条目的世界书（\d）/);
await page.screenshot({ path: S + "m-3-world.png" });
await page.click('.pa-clean-other input[data-k="示例世界书-副本"]'); await page.waitForTimeout(100);
await page.click('[data-x="del"]'); await page.waitForTimeout(200);
const dl2 = page.waitForEvent("download");
await page.click(".pa-sheet .pa-btn-danger");
assert.match((await dl2).suggestedFilename(), /^worldbooks-backup-\d+\.zip$/);
await page.waitForTimeout(300);
assert.ok(await page.evaluate(async () => (await import("/test/site/scripts/world-info.js")).world_names.includes("示例世界书-副本")), "确认前不删除世界书");
await page.click(".pa-sheet-mask:last-child .pa-btn-danger"); await page.waitForTimeout(400);
assert.ok(!(await page.evaluate(async () => (await import("/test/site/scripts/world-info.js")).world_names.includes("示例世界书-副本"))));
// 本地备份
await page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise((res, rej) => { const rq = indexedDB.open("preset-atelier", 2); rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains("backups")) d.createObjectStore("backups", { keyPath: "id", autoIncrement: true }).createIndex("preset", "preset"); if (!d.objectStoreNames.contains("assets")) d.createObjectStore("assets"); }; rq.onerror = () => rej(rq.error); rq.onsuccess = () => { const t = rq.result.transaction("backups", "readwrite"); t.objectStore("backups").add({ preset: "P1", reason: "x", time: i, data: { prompts: ["z".repeat(1000)] } }); t.oncomplete = () => { rq.result.close(); res(); }; t.onerror = () => rej(t.error); }; }); });
await page.click('[data-kind="local"]'); await page.waitForTimeout(600);
assert.match(await page.$eval(".pa-clean-other", (x) => x.innerText), /保存了 5 份预设备份/);
await page.screenshot({ path: S + "m-4-local.png" });
await page.click('[data-x="keep3"]'); await page.waitForTimeout(200);
await page.click(".pa-sheet .pa-btn-danger"); await page.waitForTimeout(800);
assert.match(await page.$eval(".pa-clean-other", (x) => x.innerText), /保存了 3 份预设备份/);
// 回到预设栏
await page.click('[data-kind="preset"]'); await page.waitForTimeout(300);
assert.ok(await page.$(".pa-clean-body .pa-verdict"));
// 日落海岸
await page.click('[data-m="look"]'); await page.click('[data-theme-id="dusk"]'); await page.waitForTimeout(200);
await page.screenshot({ path: S + "m-5-dusk.png" });
await page.evaluate(() => window.__presetAtelier.open("organize")); await page.waitForTimeout(300);
await page.screenshot({ path: S + "m-6-dusk-organize.png" });
assert.deepEqual(errs, []);
console.log("清理其他几栏检查全部通过");
await browser.close();
