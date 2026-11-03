// 2.6.9 站点编辑模式：标题右边平时是铅笔、＋ 两个图标；编辑时导入、导出、完成，每行 ≡ 拖动排序（鼠标、触屏、键盘）、
// 垃圾桶删除；多密钥站点不展开；删光后退出编辑，导入回到空列表的提示里。先构建并在仓库根目录运行 8765 静态服务。
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errs = [];
const ok = (m) => console.log("✓", m);
const SITES = ["甲站", "乙站", "丙站", "丁站", "戊站"];
async function open(page) {
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate((names) => {
    window.__toasts = [];
    window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
    const sites = names.map((n, i) => ({ id: `s${i}`, name: n, source: "custom", url: `https://s${i}.example/v1`, model: `m${i}`, models: [], secretId: null, keyMask: "", note: "" }));
    // 丙站有两个分组，先展开着
    Object.assign(sites[2], { keys: [{ id: "k1", name: "按次", model: "a" }, { id: "k2", name: "按量", model: "b" }], keyId: "k1" });
    for (const f of ["model", "models", "secretId", "keyMask"]) delete sites[2][f];
    window.SillyTavern.getContext().extensionSettings.presetAtelier = { sites, activeSiteId: "s1", fold: { sites: { s2: true } } };
    window.__presetAtelier.open("more", "schemes");
  }, SITES);
  await page.waitForTimeout(400);
}
const saved = (page) => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites.map((x) => x.name));
const shown = (page) => page.locator("#pa-root .pa-site-edit b").allTextContents();
try {
  // ---- 鼠标、键盘
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  await open(page);
  const head = page.locator("#pa-root .pa-plan-sites .pa-head-btns");
  assert.deepEqual(await head.locator("button").evaluateAll((x) => x.map((b) => [b.dataset.a, b.getAttribute("aria-label"), b.textContent.trim()])),
    [["sitesedit", "编辑站点：排序、删除、导入导出", ""], ["new", "添加站点", ""]], "平时只有铅笔、＋ 两个图标按钮，各有名称");
  assert.equal(await page.locator("#pa-root [data-import-sites]").count(), 0, "平时不显示导入");
  assert.equal(await page.locator("#pa-root .pa-kline").count(), 2, "丙站的分组平时展开着");
  ok("标题右边：铅笔、＋ 两个图标");

  await page.click("[data-a=sitesedit]");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.a), "sitesdone", "进入编辑后焦点在「完成」");
  assert.deepEqual(await head.locator("button, label").allTextContents(), ["导入", "导出", "完成"]);
  assert.equal(await page.locator("#pa-root .pa-site-edit").count(), 5);
  assert.equal(await page.locator("#pa-root .pa-site-edit .pa-site-grip").count(), 5);
  assert.equal(await page.locator("#pa-root .pa-site-edit [data-a=del]").count(), 5);
  assert.equal(await page.locator("#pa-root .pa-plan-sites .pa-swpill[data-a=use], #pa-root .pa-plan-sites .pa-fold-pill, #pa-root .pa-kline").count(), 0, "编辑时不切换、不展开分组");
  assert.match(await page.locator("#pa-root .pa-site-edit").nth(2).innerText(), /2 组/);
  assert.match(await page.locator("#pa-root .pa-site-edit").nth(1).innerText(), /使用中/);
  ok("编辑模式：导入、导出、完成；每行 ≡ 和删除，不切换、不展开");

  // 鼠标拖：甲站拖到丙站下面
  const grip = page.locator("#pa-root .pa-site-edit .pa-site-grip").first();
  const b = await grip.boundingBox();
  const step = (await page.locator("#pa-root .pa-site-edit").nth(1).boundingBox()).y - (await page.locator("#pa-root .pa-site-edit").first().boundingBox()).y;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + step * 2.2 * i / 10);
  assert.ok(await page.locator("#pa-root .pa-site-edit.pa-dragging").count(), "拖动中的一行浮起");
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.deepEqual(await saved(page), ["乙站", "丙站", "甲站", "丁站", "戊站"]);
  assert.deepEqual(await shown(page), await saved(page));
  assert.equal(await page.locator("#pa-root .pa-site-edit.pa-dragging").count(), 0);
  ok("鼠标拖动 ≡：松手后保存新顺序");

  // 键盘：焦点在 ≡ 上按上、下
  await page.locator("#pa-root .pa-site-edit .pa-site-grip").nth(2).focus();
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  assert.deepEqual(await saved(page), ["乙站", "甲站", "丙站", "丁站", "戊站"]);
  assert.match(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), /^「甲站」第 2 个，共 5 个/, "焦点跟着移动的站点");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  assert.deepEqual(await saved(page), ["甲站", "乙站", "丙站", "丁站", "戊站"], "到顶了不再动");
  ok("键盘上下方向键移动一格，焦点留在这一站");

  // 删除：确认后删掉，仍在编辑模式
  await page.locator("#pa-root .pa-site-edit", { hasText: "丁站" }).locator("[data-a=del]").click();
  await page.click(".pa-sheet-actions >> text=删除");
  await page.waitForTimeout(250);
  assert.deepEqual(await saved(page), ["甲站", "乙站", "丙站", "戊站"]);
  assert.equal(await page.locator("#pa-root [data-a=sitesdone]").count(), 1, "删除后仍在编辑模式");
  ok("垃圾桶：确认后删除");

  // 完成：回到平时的样子，丙站的分组照旧展开，焦点在铅笔
  await page.click("[data-a=sitesdone]");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.a), "sitesedit");
  assert.equal(await page.locator("#pa-root .pa-site-edit").count(), 0);
  assert.equal(await page.locator("#pa-root .pa-kline").count(), 2);
  ok("完成：回到平时，焦点在铅笔");

  // 删光：退出编辑，导入回到空列表的提示里
  await page.click("[data-a=sitesedit]");
  for (let i = 0; i < 4; i++) {
    await page.locator("#pa-root .pa-site-edit [data-a=del]").first().click();
    await page.click(".pa-sheet-actions >> text=删除");
    await page.waitForTimeout(200);
  }
  assert.deepEqual(await saved(page), []);
  assert.equal(await page.locator("#pa-root [data-a=sitesdone], #pa-root [data-a=sitesedit]").count(), 0, "没有站点：退出编辑，也没有铅笔");
  assert.equal(await page.locator("#pa-root .pa-empty label.pa-file [data-import-sites]").count(), 1, "空列表的提示里能导入");
  assert.equal(await page.locator("#pa-root .pa-plan-sites [data-a=new]").count(), 1);
  ok("删光后退出编辑；空列表里有「从文件导入」");
  await page.close();

  // ---- 触屏：真的手指拖动（指针类型 touch，≡ 上 touch-action: none）
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const tp = await ctx.newPage();
  await open(tp);
  await tp.click("[data-a=sitesedit]");
  const cdp = await ctx.newCDPSession(tp);
  const tb = await tp.locator("#pa-root .pa-site-edit .pa-site-grip").nth(4).boundingBox();
  const tstep = (await tp.locator("#pa-root .pa-site-edit").nth(4).boundingBox()).y - (await tp.locator("#pa-root .pa-site-edit").nth(3).boundingBox()).y;
  const x = tb.x + tb.width / 2, y0 = tb.y + tb.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 - tstep * 3.3 * i / 12 }] });
    await tp.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await tp.waitForTimeout(300);
  assert.deepEqual(await saved(tp), ["甲站", "戊站", "乙站", "丙站", "丁站"]);
  assert.equal(await tp.evaluate(() => getComputedStyle(document.querySelector("#pa-root .pa-site-grip")).touchAction), "none");
  ok("触屏拖动 ≡：戊站拖到第二个");
  await ctx.close();

  // ---- 站点多、窗口矮：拖到滚动区下沿时自动滚动，滚到底就停（拖着的行不撑大滚动区）
  const lp = await browser.newPage({ viewport: { width: 400, height: 640 } });
  await open(lp);
  await lp.evaluate(() => {
    const s = window.SillyTavern.getContext().extensionSettings.presetAtelier;
    s.sites = Array.from({ length: 16 }, (_, i) => ({ id: `n${i}`, name: `站${i}`, source: "custom", url: `https://n${i}.example/v1`, model: "m", models: [] }));
    window.__presetAtelier.open("more", "schemes");
  });
  await lp.waitForTimeout(300);
  await lp.click("[data-a=sitesedit]");
  const lg = lp.locator("#pa-root .pa-site-edit .pa-site-grip").first();
  await lg.scrollIntoViewIfNeeded();
  const lb = await lg.boundingBox();
  const sc = lp.locator("#pa-root .pa-plan.pa-scroll");
  const sr = await sc.boundingBox();
  await lp.mouse.move(lb.x + 10, lb.y + 10);
  await lp.mouse.down();
  for (let i = 1; i <= 8; i++) await lp.mouse.move(lb.x + 10, lb.y + 10 + (sr.y + sr.height - 20 - lb.y - 10) * i / 8);
  await lp.waitForTimeout(2500);
  const [top, max] = await sc.evaluate((x) => [x.scrollTop, x.scrollHeight - x.clientHeight]);
  assert.ok(top > 0 && top <= max + 1, `自动滚动到底为止：${top} / ${max}`);
  await lp.mouse.up();
  await lp.waitForTimeout(250);
  assert.equal((await saved(lp)).at(-1), "站0", "站0 拖到了最后");
  ok("拖到下沿自动滚动，到底即停");
  await lp.close();
} finally {
  await browser.close();
}
assert.deepEqual(errs, []);
