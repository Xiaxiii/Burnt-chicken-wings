// 测试用：点名称按钮，在弹出的列表里选一项（1.9 起预设、世界书、来源类型都用这种列表，不再是系统下拉框）
export async function choose(page, btnSel, value) {
  await page.click(btnSel);
  await page.waitForSelector(".pa-npick-item", { timeout: 5000 });
  const ok = await page.evaluate((v) => {
    const b = [...document.querySelectorAll(".pa-npick-item")].find((x) => x.dataset.v === v);
    if (b) b.click();
    return !!b;
  }, value);
  if (!ok) throw new Error(`列表里没有「${value}」`);
  await page.waitForTimeout(300);
}
// 缝合页的来源类型（preset / world / file / paste）、目标类型（preset / world）
export const chooseSrcType = (page, type) => choose(page, '[data-st="srctype"]', type);
export const chooseDstType = (page, type) => choose(page, '[data-st="dsttype"]', type);
