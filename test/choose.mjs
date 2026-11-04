// 测试用：旧检查沿用的几个操作，按 3.0 界面实现
import { choose as pick, expandAll as expand, menu } from "./helpers.mjs";
// 点名称按钮，在弹出的列表里选一项（预设、世界书等）
export async function choose(page, btnSel, value) {
  await page.locator(btnSel).first().click();
  await pick(page, value);
}
// 缝合页的来源类型（preset / world / file / paste）、目标类型（preset / world）：分段按钮
export async function chooseSrcType(page, type) {
  await page.locator(`#cw-root [data-srctype="${type}"]:visible`).first().click();
  await page.waitForTimeout(300);
}
export async function chooseDstType(page, type) {
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
