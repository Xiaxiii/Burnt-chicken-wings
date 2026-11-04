// 2.6.10 弹窗列表的底色不被别处的样式盖住。注入一组外来规则（普通的、带 !important 的；按钮、列表下的 div、
// 类名带 row / item / pick 的元素、悬停、聚焦），逐一打开选择模型（单密钥、多密钥；按模型、按分类、按分组；多选；
// 搜索无结果；「使用「…」」；三个分组时的「+N」）、选预设、弹出选项，检查列表里每个元素的底色都不是外来的颜色。
// 2.6.9 及以前：多密钥站点「按模型」「按分类」的行没有自己的底色，一条普通规则就能铺上白底、悬停变灰。
// 先构建并在仓库根目录运行 8765 静态服务。
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errs = [];
const ok = (m) => console.log("✓", m);
const WHITE = "rgb(247, 247, 247)", WHITE2 = "rgb(250, 250, 250)", GREY = "rgb(212, 212, 212)";
// 先是普通规则（行没有自己的底色时就会中招），再是带 !important 的
const FOREIGN = `
  html body [role="listbox"] > div, html body [role="listbox"] > p { background: ${WHITE}; }
  html body [role="listbox"] > div:hover { background: ${GREY}; }
  html body button, html body [role="option"], html body div[class*="row"], html body [class*="item"], html body div[class*="pick"]:not(.cw-dlg) { background: ${WHITE2} !important; }
  html body button:hover, html body button:focus, html body div[class*="row"]:hover { background: ${GREY} !important; }`;
const BAD = new Set([WHITE, WHITE2, GREY]);
const MODELS = ["[kiro]Claude-opus-4-6", "[kiro]Claude-opus-4-7", "[次AWS]Claude-opus-4-6", "[AG] Gemini-3.1-flash", "[AS]Gemini-4-argon", "gpt-5"];
try {
  const page = await browser.newPage({ viewport: { width: 430, height: 860 } });
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.addStyleTag({ content: FOREIGN });
  await page.evaluate((ms) => {
    window.__toasts = [];
    window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
    window.SillyTavern.getContext().extensionSettings.presetAtelier = {
      theme: "oat", activeSiteId: null,
      sites: [
        { id: "one", name: "单密钥", source: "custom", url: "https://one.example/v1", model: ms[0], models: ms, secretId: null, keyMask: "", note: "", modelCats: [{ id: "c1", name: "常用", models: ms.slice(0, 2) }] },
        // 三个分组都有 ms[0]，「按模型」里出现「+2」
        { id: "many", name: "多密钥", source: "custom", url: "https://many.example/v1", note: "", keyId: "k1", modelCats: [{ id: "c2", name: "Claude", models: ms.slice(0, 3) }],
          keys: [{ id: "k1", name: "", keyMask: "sk-…83Zo", model: ms[2], models: ms }, { id: "k2", name: "福利", model: "", models: [ms[0]] }, { id: "k3", name: "按量", model: "", models: [ms[0]] }] }
      ]
    };
    window.__presetAtelier.open("conn");
  }, MODELS);
  await page.waitForTimeout(400);

  // 列表（含外层）里每个元素的底色；悬停时再看一次
  // 范围：列表本身和它里面的每个元素，加上列表外面几层容器本身（列表上方的切换、多选等控件不算底板）
  const sweep = async (scope, label) => {
    const bad = await page.evaluate(([scope, bad]) => {
      const out = [];
      const outer = document.querySelectorAll("#cw-root .cw-layer > .cw-scrim:not(.cw-out) :is(.cw-mpick, .cw-chooser, .cw-chooser-top)");
      for (const x of outer) {
        const bg = getComputedStyle(x).backgroundColor;
        if (bad.includes(bg)) out.push(`${x.tagName.toLowerCase()}.${[...x.classList].join(".")} ${bg}`);
      }
      for (const root of document.querySelectorAll(scope)) {
        for (const x of [root, ...root.querySelectorAll("*")]) {
          const bg = getComputedStyle(x).backgroundColor;
          if (bad.includes(bg)) out.push(`${x.tagName.toLowerCase()}.${[...x.classList].join(".")} ${bg}`);
        }
      }
      return out;
    }, [scope, [...BAD]]);
    assert.deepEqual(bad, [], `${label}：有元素被铺上外来底色`);
  };
  const LIST = "#cw-root .cw-layer > .cw-scrim:not(.cw-out) :is(.cw-mpick-list, .cw-chooser-list, .pa-pick)";
  const hoverAll = async (label) => {
    for (const sel of [".cw-krow", ".cw-kname", ".cw-kchip", ".cw-kmore", ".cw-msec-h", "[data-catmenu]", ".cw-choice", ".cw-choice", ".cw-menu-item"]) {
      // 只在最上层的窗口里取（下面那层被遮罩挡着）
      const el = page.locator("#cw-root .cw-layer > .cw-scrim:not(.cw-out)").last().locator(sel).first();
      if (!await el.count() || !await el.isVisible()) continue;
      await el.hover();
      await sweep(LIST, `${label} · 悬停 ${sel}`);
    }
  };
  const view = async (v) => { await page.click(`#cw-root .cw-layer > .cw-scrim:not(.cw-out) .cw-mpick-top .cw-seg [data-v=${v}]`); await page.waitForTimeout(120); };
  const search = async (q) => { await page.fill("#cw-root .cw-layer > .cw-scrim:not(.cw-out) .pa-mfind .cw-input", q); await page.waitForTimeout(150); };
  const openPicker = async (siteName) => {
    await page.locator("#cw-root [data-r="sites"] .cw-site", { hasText: siteName }).locator("[data-act=edit]").first().click();
    await page.waitForTimeout(250);
    await page.click(".cw-dlg [data-f=modelbtn]");
    await page.waitForSelector(".cw-mpick-list");
  };
  // 关掉最上面的弹窗（Esc 只给最上面那个）
  const closeTop = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(220); };

  // ---- 多密钥站点
  await openPicker("多密钥");
  for (const v of ["model", "cat", "group"]) {
    await view(v);
    // 按分类：展开 Claude 分类
    if (v === "cat" && !await page.locator("#cw-root .cw-layer > .cw-scrim:not(.cw-out) .cw-krow").count()) await page.locator("#cw-root .cw-layer > .cw-scrim:not(.cw-out) .cw-msec-h").first().click();
    await sweep(LIST, `多密钥 · ${v}`);
    await hoverAll(`多密钥 · ${v}`);
  }
  await view("model");
  assert.ok(await page.locator("#cw-root .cw-layer > .cw-scrim:not(.cw-out) .cw-kmore").count(), "有「+N」");
  assert.equal(await page.locator("#cw-root .cw-layer > .cw-scrim:not(.cw-out) .cw-krow.on").evaluate((x) => getComputedStyle(x).backgroundColor) !== "rgba(0, 0, 0, 0)", true, "选中的行有选中底色");
  assert.notEqual(await page.locator("#cw-root .cw-layer > .cw-scrim:not(.cw-out) .cw-kchip.on").evaluate((x) => getComputedStyle(x).backgroundColor), "rgba(0, 0, 0, 0)", "选中的分组标签是实心的");
  await search("不存在的模型名");
  await sweep(LIST, "多密钥 · 搜索：使用「…」");
  await page.click("#cw-root .cw-layer > .cw-scrim:not(.cw-out) [data-act="selmode"]");
  await page.waitForTimeout(120);
  await search("");
  await sweep(LIST, "多密钥 · 多选");
  await hoverAll("多密钥 · 多选");
  await page.click("#cw-root .cw-layer > .cw-scrim:not(.cw-out) [data-act="selmode"]");
  await view("group");
  await search("zzz");
  await sweep(LIST, "多密钥 · 按分组 · 没有匹配");
  await search("");
  // 分类的 ⋯：贴着按钮弹出的选项
  await view("cat");
  await page.locator("#cw-root .cw-layer > .cw-scrim:not(.cw-out) [data-catmenu]").first().click();
  await page.waitForSelector("#cw-root .cw-layer .cw-menu-item");
  await sweep(LIST, "分类 ⋯ 的弹出选项");
  await hoverAll("分类 ⋯ 的弹出选项");
  await closeTop();
  await closeTop();
  await closeTop();
  ok("多密钥站点：按模型、按分类、按分组、多选、搜索、「+N」、分类 ⋯ 的弹出选项，底色都是配色里的");

  // ---- 单密钥站点
  await openPicker("单密钥");
  for (const v of ["model", "cat"]) {
    await view(v);
    await sweep(LIST, `单密钥 · ${v}`);
    await hoverAll(`单密钥 · ${v}`);
  }
  await search("不存在的模型名");
  await sweep(LIST, "单密钥 · 搜索：使用「…」");
  await closeTop();
  await closeTop();
  ok("单密钥站点：按模型、按分类、搜索，底色都是配色里的");

  // ---- 导出站点的弹出选项（编辑模式里）、选预设
  await page.click("#cw-root [data-act=sitesedit]");
  await page.click("#cw-root [data-act=exportsites]");
  await page.waitForSelector("#cw-root .cw-layer .cw-menu-item");
  await sweep(LIST, "导出站点的选项");
  await hoverAll("导出站点的选项");
  await closeTop();
  await page.evaluate(() => window.__presetAtelier.open("preset"));
  await page.click("#cw-root .pa-toolbar");
  await page.waitForSelector(".cw-dlg .cw-choice");
  await sweep(LIST, "选预设");
  await hoverAll("选预设");
  await page.fill(".cw-dlg .cw-chooser-top .cw-input", "不存在的预设");
  await page.waitForTimeout(150);
  await sweep(LIST, "选预设 · 没有匹配");
  ok("导出站点的选项、选预设：底色都是配色里的");
} finally {
  await browser.close();
}
assert.deepEqual(errs, []);
