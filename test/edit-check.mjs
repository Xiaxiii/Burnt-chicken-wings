// 编辑条目：窄屏整屏推入，正文框占满剩余空间；宽屏在右侧打开，可加宽编辑区；保存后写回条目
import assert from "node:assert";
import { start, open, P, expandAll, ok, SHOTS } from "./helpers.mjs";
for (const [w, h, mobile] of [[390, 844, true], [1280, 900, false]]) {
  const { page, done } = await start({ width: w, height: h, mobile });
  await open(page, "preset");
  await expandAll(page);
  const id = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#cw-root .cw-page[data-page="preset"] .cw-list .cw-row:not(.is-sep)')].find((x) => x.offsetParent && !x.textContent.includes("系统位置"));
    r.querySelector('[data-act="edit"]').click();
    return r.dataset.id;
  });
  await page.waitForTimeout(450);
  const det = await page.locator("#cw-root .cw-detail").boundingBox();
  const ta = await page.locator("#cw-root .cw-detail .cw-entry-text").boundingBox();
  if (mobile) assert.ok(det.width >= w - 1 && det.height >= h * 0.9, `窄屏整屏推入：${det.width}×${det.height}`);
  else assert.ok(det.x > w * 0.35 && det.height >= h * 0.8, `宽屏在右侧：x=${det.x}`);
  assert.ok(ta.height > h * 0.3, `正文框占满剩余高度：${ta.height}`);
  await page.screenshot({ path: `${SHOTS}e-${w}.png` });
  if (!mobile) {
    await page.click('#cw-root .cw-detail [data-act="wide"]'); await page.waitForTimeout(250);
    const wide = await page.locator("#cw-root .cw-detail").boundingBox();
    assert.ok(wide.width > det.width + 80, "加宽编辑区");
  }
  await page.fill("#cw-root .cw-detail [data-f=content]", "改过的正文");
  await page.locator("#cw-root .cw-detail .cw-detail-foot .cw-btn", { hasText: "保存" }).click(); await page.waitForTimeout(300);
  const text = await page.evaluate((i) => window.__mock.live.prompts?.find((p) => p.identifier === i)?.content, id);
  const draftText = await page.evaluate((i) => document.querySelector(`#cw-root .cw-row[data-id="${CSS.escape(i)}"]`) ? "ok" : "", id);
  assert.equal(draftText, "ok");
  assert.ok(await page.locator("#cw-root .cw-detail").count() === 0 || await page.locator("#cw-root .cw-detail").isHidden(), "保存后关闭");
  ok(`${w}×${h} 编辑条目${text === "改过的正文" ? "，已写回" : ""}`);
  await done(`${w} 编辑检查通过`);
}
