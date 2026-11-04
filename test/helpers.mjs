// 浏览器检查共用：启动模拟酒馆、打开面板、切页、点菜单项、选名称。先构建并在仓库根目录运行 8765 静态服务
import { chromium } from "playwright";
import assert from "node:assert";
export const SHOTS = new URL("./shots/", import.meta.url).pathname;
export const SITE = "http://127.0.0.1:8765/test/site/index.html";
export const ok = (m) => console.log("✓", m);
// settings：写进 extensionSettings.presetAtelier；init(page)：页面脚本加载前（addInitScript）
export async function start({ width = 1280, height = 900, mobile = false, settings = null, url = SITE, init = null, browser = null } = {}) {
  const own = !browser;
  browser ||= await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
  const page = await browser.newPage({ viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  page.setDefaultTimeout(8000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  if (init) await init(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  if (settings) await page.evaluate((s) => { const es = window.SillyTavern.getContext().extensionSettings; es.presetAtelier = { ...(es.presetAtelier || {}), ...s }; }, settings);
  const done = async (msg) => {
    assert.deepEqual(errs, [], "页面没有报错");
    console.log(msg);
    if (own) await browser.close();
    else await page.close();
  };
  return { browser, page, errs, done };
}
// 打开面板：tab 为页面名（preset / stitch / reply / conn / clean / backup / health / look）或旧名
export async function open(page, tab, sub) {
  await page.evaluate(([t, s]) => window.__presetAtelier.open(t, s), [tab ?? null, sub ?? null]);
  await page.waitForTimeout(400);
}
export const P = (k) => `#cw-root .cw-page[data-page="${k}"]`;
// 窄屏上清理、备份、体检、外观收在「更多」里
export async function nav(page, k) {
  const direct = page.locator(`#cw-root [data-nav="${k}"]:visible`).first();
  if (!(await direct.count())) {
    await page.locator('#cw-root .cw-tabbar [data-nav="more"]').click();
    await page.waitForTimeout(250);
  }
  await page.locator(`#cw-root [data-nav="${k}"]:visible`).first().click();
  await page.waitForTimeout(350);
}
// 点弹出菜单（贴着按钮的或弹窗里的）中文字匹配的一项
export async function menu(page, text) {
  const item = page.locator("#cw-root .cw-layer .cw-menu-item").filter({ hasText: text }).last();
  await item.click();
  await page.waitForTimeout(300);
}
// 名称列表（预设、世界书、角色卡…）里选一项
export async function choose(page, value) {
  await page.waitForSelector("#cw-root .cw-layer .cw-choice, #cw-root .cw-layer .cw-menu-item", { timeout: 5000 });
  const okay = await page.evaluate((v) => {
    const layer = document.querySelector("#cw-root .cw-layer");
    const b = [...layer.querySelectorAll(".cw-choice[data-v]")].find((x) => x.dataset.v === v) || [...layer.querySelectorAll(".cw-menu-item")].find((x) => x.querySelector(".cw-menu-label")?.textContent.trim() === v);
    if (b) b.click();
    return !!b;
  }, value);
  if (!okay) throw new Error(`列表里没有「${value}」`);
  await page.waitForTimeout(300);
}
// 最上层弹窗
export const DLG = "#cw-root .cw-layer > .cw-scrim:not(.cw-out):last-child .cw-dlg";
export async function dlgButton(page, text) {
  await page.locator(`${DLG} .cw-dlg-foot .cw-btn`).filter({ hasText: text }).last().click();
  await page.waitForTimeout(350);
}
// 预设页：全部展开
export async function expandAll(page) {
  for (let i = 0; i < 80; i++) {
    const n = await page.evaluate(() => {
      const b = document.querySelector('#cw-root .cw-page[data-page="preset"] .cw-group.is-col .cw-gname');
      b?.click();
      return !!b;
    });
    if (!n) break;
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(150);
}
// 名称列表：预设页条目名
export const entryNames = (page, scope = P("preset")) => page.evaluate((s) => [...document.querySelectorAll(`${s} .cw-list .cw-row .cw-row-name`)].map((x) => x.textContent.trim()), scope);
// toast 收集：酒馆的 toastr 换成记录
export const catchToasts = (page) => page.evaluate(() => {
  window.__toasts = [];
  window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => { window.__toasts.push(`${k}:${String(m).replace(/<[^>]+>/g, "")}`); return { length: 0 }; }]));
});
export const toasts = (page) => page.evaluate(() => window.__toasts || []);
// 再加一个预设（复制最后一个）
export const addPreset = (page, name, data = null) => page.evaluate(([n, d]) => { const m = window.__mock; m.names.push(n); m.presets.push(d || structuredClone(m.presets[m.presets.length - 1])); }, [name, data]);
// 「回复」页：打开并展开「检查粘贴的文字」
export async function replyPage(page) {
  // 面板已打开时只切页（重新打开会把当前预设换回酒馆正在用的）
  const shown = await page.evaluate(() => { const r = document.getElementById("cw-root"); return !!r && !r.hidden; });
  if (shown) await page.locator('#cw-root [data-nav="reply"]:visible').first().click();
  else await page.evaluate(() => window.__presetAtelier.open("reply"));
  await page.locator("#cw-root [data-act=rp-latest]").waitFor({ state: "visible" });
  await page.evaluate(() => document.querySelectorAll("#cw-root .cw-reply-paste").forEach((d) => { d.open = true; }));
  await page.waitForTimeout(150);
}
// 保存规则：没启用时点「按这些标签启用检查」，已启用时提交各输入框（改动即保存）
export async function replySave(page) {
  const en = page.locator("#cw-root [data-act=rp-enable]");
  if (await en.count()) await en.click();
  else await page.evaluate(() => document.querySelectorAll("#cw-root [data-r=rules] [data-f]").forEach((x) => x.dispatchEvent(new Event("change", { bubbles: true }))));
  await page.waitForTimeout(250);
}
// 放弃没保存的输入：重新打开回复页，表单按已保存的规则重画
export const replyCancel = (page) => replyPage(page);
