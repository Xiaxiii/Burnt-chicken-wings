// 测试用：旧检查沿用的几个操作，按 3.0 界面实现
import { choose as pick, expandAll as expand, menu } from "./helpers.mjs";
// 窄屏缝合页一次只显示「从」或「到」：要点的东西在另一边时先切过去
export async function reveal(page, sel) {
  const loc = page.locator(sel).first();
  if (await loc.isVisible().catch(() => false)) return;
  const side = /dst|pane-dst/.test(sel) ? "dst" : /src|pane-src/.test(sel) ? "src" : null;
  const b = side && page.locator(`#cw-root button[data-pane="${side}"]:visible`);
  if (b && await b.count()) { await b.first().click(); await page.waitForTimeout(250); }
}
// 窄屏上点「从」「到」两栏里的东西前，先切到那一栏（给 Locator 的动作打一次补丁）
let patched = false;
export function autoReveal(page) {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(page.locator("body"));
  for (const name of ["click", "check", "uncheck", "fill", "dblclick"]) {
    const orig = proto[name];
    proto[name] = async function (...args) {
      const sel = String(this._selector || "");
      if (/pane-(src|dst)|src-pick|dst-pick|data-q=(src|dst)|qclear-(src|dst)/.test(sel)) {
        const pg = this._frame?._page || this.page?.();
        if (pg) await reveal(pg, sel.replace(/ >> .*$/, ""));
      }
      return orig.apply(this, args);
    };
  }
}
// 点名称按钮，在弹出的列表里选一项（预设、世界书等）
export async function choose(page, btnSel, value) {
  autoReveal(page);
  await reveal(page, btnSel);
  await page.locator(btnSel).first().click();
  await pick(page, value);
}
// 缝合页的来源类型（preset / world / file / paste）、目标类型（preset / world）：分段按钮
export async function chooseSrcType(page, type) {
  autoReveal(page);
  await page.locator(`#cw-root [data-srctype="${type}"]:visible`).first().click();
  await page.waitForTimeout(300);
}
export async function chooseDstType(page, type) {
  autoReveal(page);
  await page.locator(`#cw-root [data-dsttype="${type}"]:visible`).first().click();
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
