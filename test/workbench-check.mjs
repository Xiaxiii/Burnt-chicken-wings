// 重设计后的任务流：目录定位、搜索退出、详情取消、连接视图和回复规则入口。
// 用公开合成预设，所有统计从条目开关计算；不依赖截图或固定像素布局。
import assert from "node:assert/strict";
import fixture from "./fixtures/group-toggle.cjs";
import { start, open, nav, connView, addPreset, P, ok } from "./helpers.mjs";

const presetName = "工作台交互合成预设";
const summaryValues = (page) => page.locator(`${P("preset")} .cw-entry-summary .cw-num`).evaluateAll((xs) => xs.map((x) => Number(x.textContent)));
const outlineGroup = (page, id) => page.locator(`${P("preset")} .cw-outline-item[data-outline-all="false"][data-outline-gid="${id}"]`);
const entryGroup = (page, id) => page.locator(`${P("preset")} .cw-list .cw-group[data-gid="${id}"]`);
const withinScroller = (locator) => locator.evaluate((el) => {
  const scroller = el.closest(".cw-body"), r = el.getBoundingClientRect(), s = scroller.getBoundingClientRect();
  return r.bottom > s.top && r.top < s.bottom && r.right > s.left && r.left < s.right;
});

for (const width of [1440, 390]) {
  const mobile = width < 960;
  const { page, browser, done } = await start({ width, height: mobile ? 844 : 900, mobile, init: (p) => p.emulateMedia({ reducedMotion: "reduce" }) });
  try {
    const data = fixture();
    data.extensions.baibaiToolkit.presetPromptGroups.groups.find((g) => g.id === "extras").collapsed = true;
    const expectedTotal = data.prompt_order[0].order.length;
    const expectedOn = data.prompt_order[0].order.filter((o) => o.enabled !== false).length;
    await addPreset(page, presetName, data);
    await page.evaluate((name) => {
      const m = window.__mock;
      m.live.preset_settings_openai = name;
      Object.assign(m.live, structuredClone(m.presets[m.names.indexOf(name)]));
    }, presetName);
    await open(page, "preset");
    assert.deepEqual(await summaryValues(page), [expectedTotal, expectedOn]);
    assert.equal(await outlineGroup(page, "theater").locator(":scope > small").textContent(), "1/3");
    assert.equal(await outlineGroup(page, "extras").locator(":scope > small").textContent(), "0/2");
    assert.equal(await entryGroup(page, "extras").evaluate((el) => el.classList.contains("is-col")), true);

    const outline = page.locator(`${P("preset")} .cw-outline`);
    const outlineToggle = page.locator(`${P("preset")} [data-act="outline-toggle"]`);
    if (mobile) {
      assert.equal(await outline.isVisible(), false, "目录收起时保留完整条目工作区");
      await outlineToggle.click();
    }
    await outlineGroup(page, "extras").click();
    assert.equal(await entryGroup(page, "extras").evaluate((el) => el.classList.contains("is-col")), false, "从目录定位时展开所选分组");
    assert.equal(await outlineGroup(page, "extras").getAttribute("aria-current"), "location");
    assert.equal(await withinScroller(entryGroup(page, "extras")), true, "定位的分组进入列表可见区域");
    if (mobile) assert.equal(await outline.isVisible(), false, "选中分组后返回条目工作区");

    const search = page.locator(`${P("preset")} .cw-entry-paper [data-q]`);
    await search.fill("额外");
    await page.waitForFunction(() => document.querySelector(".cw-outline-query"));
    assert.equal(await outlineGroup(page, "theater").count(), 0, "目录只保留搜索命中的分组");
    assert.equal(await outlineGroup(page, "extras").count(), 1);
    if (mobile) await outlineToggle.click();
    await page.locator(`${P("preset")} [data-act="outline-clear"]`).click();
    assert.equal(await search.inputValue(), "");
    assert.equal(await outlineGroup(page, "theater").count(), 1, "清空搜索恢复完整目录");
    if (mobile) {
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest(".cw-outline")), true, "清空后焦点仍在目录中");
      await page.keyboard.press("Escape");
      assert.equal(await outline.isVisible(), false, "Escape 关闭目录");
      assert.equal(await page.locator("#cw-root").isVisible(), true, "Escape 不关闭整个面板");
      assert.equal(await outlineToggle.evaluate((el) => el === document.activeElement), true, "焦点返回目录按钮");
    }

    // 独立开关更新总数、分组数和保存的数据，列表行仍是原来的节点。
    const row = page.locator(`${P("preset")} .cw-list .cw-row[data-id="extra1"]`);
    await row.evaluate((el) => { window.__workbenchRow = el; });
    await row.locator(".cw-switch").click();
    await page.waitForFunction((name) => {
      const m = window.__mock, p = m.presets[m.names.indexOf(name)];
      return p.prompt_order[0].order.find((o) => o.identifier === "extra1").enabled === true;
    }, presetName);
    assert.deepEqual(await summaryValues(page), [expectedTotal, expectedOn + 1]);
    assert.equal(await outlineGroup(page, "extras").locator(":scope > small").textContent(), "1/2");
    assert.equal(await page.evaluate(() => window.__workbenchRow.isConnected), true, "单条开关不重建列表行");

    // 编辑仍在原预设上工作；返回详情不能提交尚未保存的正文。
    await row.locator('[data-act="edit"]').click();
    const detail = page.locator("#cw-root .cw-detail");
    await detail.waitFor({ state: "visible" });
    assert.equal(await detail.locator('[data-f="name"]').inputValue(), "额外一");
    const content = detail.locator('[data-f="content"]');
    assert.equal(await content.inputValue(), "规则 extra1");
    if (mobile) {
      const fillsWorkArea = await detail.evaluate((el) => {
        const r = el.getBoundingClientRect(), s = el.closest(".cw-stage").getBoundingClientRect();
        return r.width >= s.width * .95 && r.height >= s.height * .95;
      });
      assert.equal(fillsWorkArea, true, "手机详情占满工作区");
      assert.equal(await page.locator("#cw-root .cw-tabbar").isVisible(), false, "编辑时收起底部导航");
      assert.equal(await detail.locator(".cw-mobile-back").isVisible(), true);
    }
    await content.fill("这段正文尚未保存");
    await detail.locator('[data-act="detail-close"]:visible').first().click();
    assert.equal(await detail.count(), 0);
    assert.equal(await page.evaluate((name) => {
      const m = window.__mock;
      return m.presets[m.names.indexOf(name)].prompts.find((p) => p.identifier === "extra1").content;
    }, presetName), "规则 extra1", "关闭详情保留原正文");
    ok(`${width}：目录统计、定位、搜索退出和详情取消`);

    // 从外观页真实切字号，正文按钮、导航和目录名称都应随偏好变化。
    const fontSizes = {};
    for (const size of ["s", "l", "m"]) {
      await nav(page, "look");
      await page.locator(`${P("look")} button[data-fs="${size}"]`).click();
      await nav(page, "preset");
      if (mobile) await outlineToggle.click();
      const probe = async (locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      fontSizes[size] = {
        button: await probe(page.locator(`${P("preset")} [data-act="add"]`)),
        navigation: await probe(page.locator('#cw-root [data-nav="preset"]:visible').first()),
        outline: await probe(outlineGroup(page, "theater").locator(":scope > span"))
      };
      if (mobile) await page.locator(`${P("preset")} [data-act="outline-close"]`).click();
    }
    for (const element of ["button", "navigation", "outline"]) {
      assert.ok(fontSizes.l[element] > fontSizes.s[element] * 1.15, `${element} 的大号文字应显著大于小号文字`);
      assert.ok(fontSizes.m[element] > fontSizes.s[element] && fontSizes.m[element] < fontSizes.l[element], `${element} 的标准字号应介于小、大之间`);
    }
    ok(`${width}：真实外观字号选择同步按钮、导航和目录名称 ${JSON.stringify(fontSizes)}`);

    await nav(page, "conn");
    assert.deepEqual(await page.locator(`${P("conn")} [data-connview]`).evaluateAll((xs) => xs.map((x) => x.dataset.connview)), ["sites", "schemes", "opts"]);
    for (const [view, action] of [["schemes", '[data-s="new"]'], ["opts", '[data-act="reasoningfollow"]'], ["sites", '[data-act="new"]']]) {
      await connView(page, view);
      assert.equal(await page.locator(`${P("conn")} [data-cview="${view}"]`).isVisible(), true);
      assert.equal(await page.locator(`${P("conn")} ${action}`).isVisible(), true, `${view} 的操作可达`);
      assert.equal(await page.locator(`${P("conn")} [data-connview="${view}"]`).getAttribute("aria-selected"), "true");
    }
    await open(page, "more", "schemes");
    assert.equal(await page.locator(`${P("conn")} [data-cview="schemes"]`).isVisible(), true, "旧方案入口直达方案视图");
    await open(page, "more", "api");
    assert.equal(await page.locator(`${P("conn")} [data-cview="sites"]`).isVisible(), true, "旧 API 入口直达站点视图");

    await nav(page, "reply");
    const setup = page.locator(`${P("reply")} [data-act="rp-setup"]`);
    assert.equal(await setup.isVisible(), true, "未启用规则时提供设置入口");
    await setup.click();
    await page.waitForFunction(() => document.activeElement?.matches('.cw-page[data-page="reply"] [data-r="rules"] input[data-f="body"]'));
    const ruleInput = page.locator(`${P("reply")} [data-r="rules"] input[data-f="body"]`);
    assert.equal(await withinScroller(ruleInput), true, "设置入口将规则输入框带入可见工作区");
    assert.equal(await page.locator(`${P("reply")} [data-act="rp-enable"]`).count(), 1, "打开设置不自动启用规则");
    ok(`${width}：连接视图、旧入口兼容和回复规则入口`);
    await done(`${width} 工作台交互检查通过`);
  } catch (err) {
    await browser.close();
    throw err;
  }
}
