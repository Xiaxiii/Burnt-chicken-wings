// 预设页（点行选中 → 移动 → 点位置）、思维链视图、当前连接换模型、缝合位置标记。用合成的「众生相风格」预设
import assert from "node:assert";
import { start, open, nav, P, expandAll, entryNames, ok } from "./helpers.mjs";
const { page, done } = await start({ width: 1280, height: 1000 });
await page.evaluate(() => {
  document.body.insertAdjacentHTML("beforeend", '<select id="model_custom_select"><option value="claude-opus">claude-opus</option><option value="claude-sonnet">claude-sonnet</option></select><input id="custom_model_id">');
  window.SillyTavern.getContext().extensionSettings.presetAtelier = { sites: [{ id: "s1", name: "中转A", source: "custom", url: "https://example.com/v1", model: "claude-x", models: [], keyMask: "sk-…L3a" }], activeSiteId: "s1" };
});
await open(page, "preset");
await expandAll(page);
// 1) 点两行选中，移动到第 6 行之后
const before = await entryNames(page);
const rows = page.locator(`${P("preset")} .cw-list .cw-row`);
await rows.nth(1).click();
await rows.nth(2).click();
assert.match(await page.textContent(`${P("preset")} .cw-selcount`), /已选 2 条/);
await page.click(`${P("preset")} [data-act="sel-moveto"]`); await page.waitForTimeout(200);
const target = before[6];
await rows.nth(6).click(); await page.waitForTimeout(300);
const after = await entryNames(page);
const ti = after.indexOf(target);
assert.deepEqual(after.slice(ti + 1, ti + 3), [before[1], before[2]], "移到目标条目之后");
ok("选中两条并移到指定位置");
// 2) 思维链视图：有结论、有手动指定入口
await page.click(`${P("preset")} [data-view="cot"]`); await page.waitForTimeout(400);
assert.ok(await page.isVisible(`${P("preset")} [data-act="cot-markpick"]`), "有手动指定思维链条目的入口");
ok("思维链视图");
// 3) 连接页：当前连接换模型（带搜索的列表），站点记录跟着改
await nav(page, "conn");
await page.click(`${P("conn")} [data-act="livemodel"]`); await page.waitForTimeout(250);
await page.locator("#cw-root .cw-layer .cw-choice", { hasText: "claude-sonnet" }).click(); await page.waitForTimeout(300);
const m = await page.evaluate(() => [document.getElementById("custom_model_id").value, window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].model]);
assert.deepEqual(m, ["claude-sonnet", "claude-sonnet"]);
ok("当前连接换模型");
// 4) 缝合位置：点展开的组里的条目＝放进组里，它的后面
await nav(page, "stitch");
const g = page.locator(`${P("stitch")} .cw-pane-dst .cw-group`).nth(1);
if (await g.evaluate((x) => x.classList.contains("is-col"))) { await g.locator(".cw-gname").click(); await page.waitForTimeout(200); }
const rowName = (await g.locator(".cw-row .cw-row-name").first().textContent()).trim();
await g.locator(".cw-row").first().click(); await page.waitForTimeout(200);
const where = await page.textContent(`${P("stitch")} .cw-where`);
assert.ok(where.includes("组内") && where.includes(rowName), where);
ok(`缝合位置：${where}`);
await done("界面检查全部通过");
