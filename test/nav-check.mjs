// 2.7.0 导航：手机底部五栏、宽屏左侧栏、分页、批次栏位置、旧的打开方式仍可用
// 用法：在仓库根目录起静态服务（python3 -m http.server 8765）；node test/nav-check.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
const PORT = process.env.PA_PORT || 8765;
const S = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const ok = (m) => console.log("✓", m);

async function boot(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/api/presets/save", (r) => r.fulfill({ json: { name: r.request().postDataJSON().name } }));
  await page.goto(`http://127.0.0.1:${PORT}/test/site/index.html`);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  return { page, errs };
}
const state = (page) => page.evaluate(() => {
  const root = document.getElementById("pa-root");
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  return {
    title: root.querySelector(".pa-title").textContent,
    page: [...root.querySelectorAll(".pa-page")].filter((p) => !p.hidden).map((p) => p.dataset.page),
    nav: [...root.querySelectorAll(".pa-tabs [data-nav]")].filter(vis).map((b) => b.textContent.trim()),
    navOn: [...root.querySelectorAll('.pa-tabs [aria-current="page"]')].filter(vis).map((b) => b.textContent.trim()),
    sub: vis(root.querySelector(".pa-subnav")) ? [...root.querySelectorAll(".pa-subnav button")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")) : []
  };
});

// 手机
{
  const { page, errs } = await boot({ width: 390, height: 844 }, true);
  await page.evaluate(() => window.__presetAtelier.open());
  await page.waitForTimeout(300);
  let s = await state(page);
  assert.deepEqual(s.nav, ["预设", "方案", "连接", "回复", "更多"]);
  assert.deepEqual(s.navOn, ["预设"]);
  assert.equal(s.title, "预设");
  assert.deepEqual(s.sub, ["条目*", "思维链"]);
  assert.deepEqual(s.page, ["organize"]);
  await page.screenshot({ path: S + "n-1-phone-preset.png" });
  ok("手机：底部五栏，预设下分条目、思维链");

  await page.click('.pa-subnav [data-tab="cot"]');
  s = await state(page);
  assert.deepEqual(s.page, ["cot"]);
  assert.deepEqual(s.sub, ["条目", "思维链*"]);
  await page.click('.pa-tabs [data-nav="schemes"]');
  s = await state(page);
  assert.equal(s.title, "方案"); assert.deepEqual(s.page, ["schemes"]); assert.deepEqual(s.sub, []);
  assert.ok(await page.locator("[data-page=schemes] .pa-plan-schemes").isVisible());
  await page.click('.pa-tabs [data-nav="conn"]');
  s = await state(page);
  assert.equal(s.title, "连接"); assert.deepEqual(s.page, ["conn"]);
  assert.ok(await page.locator("[data-page=conn] .pa-plan-live").isVisible());
  assert.ok(await page.locator("[data-page=conn] .pa-plan-sites").isVisible());
  await page.screenshot({ path: S + "n-2-phone-conn.png" });
  ok("手机：方案、连接分为两页");

  await page.click('.pa-tabs [data-nav="reply"]');
  s = await state(page);
  assert.equal(s.title, "回复"); assert.deepEqual(s.page, ["reply"]);
  assert.ok(await page.locator('[data-page=reply] [data-r="body"]').isVisible(), "回复页内有正文标签输入框");
  await page.fill('[data-page=reply] [data-r="body"]', "content");
  await page.click('[data-page=reply] [data-r="save"]');
  await page.waitForTimeout(200);
  const saved = await page.evaluate(() => { const c = window.SillyTavern.getContext(); const n = window.__mock?.names?.[0]; return c.extensionSettings.presetAtelier.replyGuard; });
  assert.ok(saved && Object.values(saved).some((v) => v.bodyTag === "content"), "回复页保存设置写入当前预设");
  await page.screenshot({ path: S + "n-3-phone-reply.png" });
  ok("手机：回复页内直接设置、保存");

  await page.click('.pa-tabs [data-nav="more"]');
  s = await state(page);
  assert.deepEqual(s.navOn, ["更多"]);
  assert.equal(s.sub.length, 4);
  await page.click('.pa-subnav [data-m="health"]');
  s = await state(page);
  assert.equal(s.title, "体检"); assert.deepEqual(s.page, ["health"]); assert.deepEqual(s.sub, ["缝合", "清理", "体检*", "设置"]);
  await page.click('.pa-tabs [data-nav="preset"]');
  s = await state(page);
  assert.deepEqual(s.page, ["cot"], "回到预设时停在上次的分页");
  await page.click('.pa-tabs [data-nav="more"]');
  s = await state(page);
  assert.deepEqual(s.page, ["health"], "回到更多时停在上次的分页");
  ok("手机：更多下分缝合、清理、体检、设置，记住上次的分页");

  // 旧的打开方式
  await page.evaluate(() => window.__presetAtelier.open("more", "look"));
  assert.deepEqual((await state(page)).page, ["look"]);
  await page.evaluate(() => window.__presetAtelier.open("suture"));
  assert.deepEqual((await state(page)).page, ["suture"]);
  await page.evaluate(() => window.__presetAtelier.open("organize"));
  assert.deepEqual((await state(page)).page, ["organize"]);
  ok("旧写法 open(\"more\", 子页)、open(\"suture\") 仍可用");

  // 有修改时批次栏出现在底部导航上方
  await page.locator("[data-page=organize] .pa-row .pa-switch").first().click();
  await page.waitForTimeout(700);
  const box = await page.evaluate(() => {
    const r = (q) => document.querySelector(q).getBoundingClientRect();
    return { bar: r(".pa-savebar"), tabs: r(".pa-tabs"), text: document.querySelector(".pa-dirty-text").textContent };
  });
  assert.ok(box.bar.height > 0 && Math.abs(box.bar.bottom - box.tabs.top) <= 1, `批次栏紧贴底部导航 ${box.bar.bottom} / ${box.tabs.top}`);
  assert.ok(await page.locator('.pa-savebar [data-g="undo"]').isVisible());
  await page.screenshot({ path: S + "n-4-phone-savebar.png" });
  await page.click('.pa-savebar [data-g="undo"]');
  await page.waitForTimeout(500);
  ok(`批次栏在底部导航上方（${box.text}），可撤销`);
  assert.deepEqual(errs, []);
  await page.close();
}

// 宽屏
for (const [w, h] of [[1280, 800], [1024, 768]]) {
  const { page, errs } = await boot({ width: w, height: h }, false);
  await page.evaluate(() => window.__presetAtelier.open());
  await page.waitForTimeout(300);
  let s = await state(page);
  assert.deepEqual(s.nav, ["预设", "方案", "连接", "回复", "缝合", "清理", "体检", "设置"]);
  const side = await page.evaluate(() => document.querySelector(".pa-tabs").getBoundingClientRect().toJSON());
  assert.ok(side.left === 0 && side.width > 180 && side.width < 260 && side.height > h - 60, "左侧栏贴左、全高");
  assert.deepEqual(s.sub, ["条目*", "思维链"]);
  await page.click('.pa-tabs [data-nav="clean"]');
  s = await state(page);
  assert.equal(s.title, "清理"); assert.deepEqual(s.page, ["clean"]); assert.deepEqual(s.sub, [], "宽屏不显示「更多」的分页");
  assert.deepEqual(s.navOn, ["清理"]);
  await page.screenshot({ path: S + `n-5-wide-${w}-clean.png` });
  await page.click('.pa-tabs [data-nav="preset"]');
  await page.screenshot({ path: S + `n-6-wide-${w}-preset.png` });
  ok(`宽屏 ${w}：左侧栏分工作、工具两组`);
  assert.deepEqual(errs, []);
  await page.close();
}
await browser.close();
console.log("导航检查通过");
