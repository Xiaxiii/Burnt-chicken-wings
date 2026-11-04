// 测试用：旧检查沿用的几个操作，按 3.0 界面实现
import { chromium } from "playwright";
import { choose as pick, expandAll as expand, menu } from "./helpers.mjs";
// 窄屏缝合页一次只显示「从」或「到」：要点的东西在另一栏时，先点「从 / 到」切过去（和人操作一样）
async function sideOf(loc) {
  return loc.evaluate((el) => el.closest(".cw-pane-dst") ? "dst" : el.closest(".cw-pane-src") ? "src" : null, null, { timeout: 1000 }).catch(() => null);
}
async function switchTo(page, side) {
  const b = side && page.locator(`#cw-root button[data-pane="${side}"]:visible`);
  if (b && await b.count()) { await b.first().click(); await page.waitForTimeout(250); }
}
export async function reveal(page, sel) {
  if (typeof sel !== "string") return;
  const loc = page.locator(sel).first();
  if (!(await loc.count().catch(() => 0))) return;
  if (await loc.isVisible().catch(() => false)) return;
  await switchTo(page, await sideOf(loc));
}
const ACTIONS = ["click", "check", "uncheck", "fill", "dblclick"];
const patchedPages = new WeakSet();
let locatorPatched = false;
export function autoReveal(page) {
  if (!patchedPages.has(page)) {
    patchedPages.add(page);
    for (const name of ACTIONS) {
      const orig = page[name].bind(page);
      page[name] = async (sel, ...rest) => { await reveal(page, sel); return orig(sel, ...rest); };
    }
  }
  if (locatorPatched) return;
  locatorPatched = true;
  const proto = Object.getPrototypeOf(page.locator("body"));
  for (const name of ACTIONS) {
    const orig = proto[name];
    proto[name] = async function (...args) {
      const pg = this.page?.();
      if (pg && await this.count().catch(() => 0) && !(await this.first().isVisible().catch(() => true))) await switchTo(pg, await sideOf(this.first()));
      return orig.apply(this, args);
    };
  }
}
// 引入本文件的检查：新开的页面都装上 autoReveal
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...a) => {
  const b = await launch(...a);
  const wrap = (p) => { autoReveal(p); return p; };
  const np = b.newPage.bind(b);
  b.newPage = async (...x) => wrap(await np(...x));
  const nc = b.newContext.bind(b);
  b.newContext = async (...x) => { const c = await nc(...x); const cp = c.newPage.bind(c); c.newPage = async (...y) => wrap(await cp(...y)); return c; };
  return b;
};
// 点名称按钮，在弹出的列表里选一项（预设、世界书等）
export async function choose(page, btnSel, value) {
  await reveal(page, btnSel);
  await page.locator(btnSel).first().click();
  await pick(page, value);
}
// 缝合页的来源类型（preset / world / file / paste）、目标类型（preset / world）：分段按钮
export async function chooseSrcType(page, type) {
  await page.locator(`#cw-root .cw-pane-src [data-srctype="${type}"]`).first().click();
  await page.waitForTimeout(300);
}
export async function chooseDstType(page, type) {
  await page.locator(`#cw-root .cw-pane-dst [data-dsttype="${type}"]`).first().click();
  await page.waitForTimeout(300);
}
// 预设页工具：＋（新建条目、新建分组）和 ⋯（智能分组、全部展开或折叠、多选排列）
const MENU_OF = { newentry: ["add", "新建条目"], newgroup: ["add", "新建分组"], smart: ["tools", "智能分组"], fold: ["tools", /全部展开|全部折叠/], clickorder: ["tools", "多选排列：按点选先后"] };
export async function organizeTool(page, tool) {
  const [btn, text] = MENU_OF[tool];
  await page.locator(`#cw-root .cw-page[data-page="preset"] [data-act="${btn}"]:visible`).first().click();
  await page.waitForTimeout(200);
  await menu(page, text);
}
export const expandAll = (page) => expand(page);
