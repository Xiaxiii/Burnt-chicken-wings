// 2.6.4 缝合页分组折叠：预设重新读取后分组编号变了（没有编号的分组每次读取都会分到新编号），
// 展开、收起的状态照旧，不会全部变成展开。先构建并在仓库根目录运行 8765 静态服务。
import { chromium } from "playwright";
import assert from "node:assert";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => { window.SillyTavern.getContext().extensionSettings.presetAtelier = {}; window.__presetAtelier.open("suture"); });
await page.waitForTimeout(400);
const fold = (side) => page.evaluate((side) => [...document.querySelectorAll(`.pa-${side}-list .pa-group`)].map((g) => (g.classList.contains("pa-collapsed") ? "-" : "+") + g.querySelector(".pa-gname")?.textContent.trim()).join(" "), side);
// 换掉所有分组编号（模拟没有编号的分组被重新读取），并让草稿重新读取
const regenIds = () => page.evaluate(() => {
  const m = window.__mock;
  const objs = [...m.presets, m.live].filter(Boolean);
  for (const p of objs) {
    const g = p.extensions?.baibaiToolkit?.presetPromptGroups;
    if (!g) continue;
    const map = new Map(g.groups.map((x) => [x.id, "new-" + Math.random().toString(36).slice(2)]));
    for (const x of g.groups) x.id = map.get(x.id);
    for (const v of Object.values(g.prompts || {})) if (map.has(v.groupId)) v.groupId = map.get(v.groupId);
  }
  const c = window.SillyTavern.getContext();
  return c.eventSource.emit(c.eventTypes.PRESET_CHANGED, { apiId: "openai", name: m.names[0] });
});

await page.locator(".pa-src-list .pa-group").nth(1).locator(".pa-ghead").click(); await page.waitForTimeout(150);
await page.locator(".pa-dst-list .pa-group").nth(2).locator(".pa-caret").click(); await page.waitForTimeout(150);
const src0 = await fold("src"), dst0 = await fold("dst");
assert.match(src0, /^-\S+ \+/, src0);
await regenIds(); await page.waitForTimeout(500);
assert.equal(await fold("src"), src0, "来源：编号变了，展开的组仍展开，其余仍收起");
assert.equal(await fold("dst"), dst0, "目标：同上");
// 收起后再重新读取，仍是收起
await page.locator(".pa-src-list .pa-group").nth(1).locator(".pa-ghead").click(); await page.waitForTimeout(150);
await regenIds(); await page.waitForTimeout(500);
assert.ok(!(await fold("src")).includes("+"), "收起后重新读取，不会又展开");
console.log("✓ 缝合页分组折叠：预设重新读取、分组编号变化后保持原状");
assert.deepEqual(errs, []);
await browser.close();
