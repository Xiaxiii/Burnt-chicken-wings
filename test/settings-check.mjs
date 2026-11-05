// 扩展页设置框、防下拉刷新开关、魔棒菜单位置
import assert from "node:assert";
import { start, ok, SHOTS } from "./helpers.mjs";
const { page, done } = await start({ width: 820, height: 1180, mobile: true });
await page.waitForSelector("#cw-settings");
// 模拟酒馆把字号调大
await page.addStyleTag({ content: ":root{--mainFontSize:22px} body{font-size:22px} code{background:#eee;color:#eee}" });
assert.ok(await page.$("#cw-pull-guard"), "默认开启防下拉刷新");
assert.equal(await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY), "none");
const over = await page.$eval("#cw-settings", (b) => [...b.querySelectorAll(".cw-set-intro, .cw-set-foot, .cw-set-note")].some((x) => x.scrollWidth > x.clientWidth + 2));
assert.ok(!over, "说明文字不横向溢出");
assert.match(await page.textContent(".cw-set-foot"), /\/atelier/);
await page.$eval("#cw-settings", (b) => b.scrollIntoView());
await page.click('#cw-settings [data-r="compat"] summary');
await page.click("[data-opt=noPullRefresh]");
assert.ok(!(await page.$("#cw-pull-guard")), "关闭后移除");
await page.click("[data-opt=noPullRefresh]");
assert.ok(await page.$("#cw-pull-guard"));
ok("防下拉刷新开关");
// 改名：原地改，面板和菜单同步
await page.click('#cw-settings [data-a="rename"]');
await page.fill("#cw-settings .cw-set-input", "鸡翅测试");
await page.click('#cw-settings [data-a="rename-ok"]');
assert.equal(await page.textContent('#cw-settings [data-r="name"] .cw-appname'), "鸡翅测试");
assert.equal(await page.textContent("#cw-menu-entry .cw-appname"), "鸡翅测试");
ok("改名同步到菜单");
// 魔棒菜单：别的扩展晚加进来，本项也留在最下面
const last = await page.evaluate(async () => {
  const m = document.getElementById("extensionsMenu");
  const x = document.createElement("div"); x.textContent = "后加载的扩展"; m.append(x);
  await new Promise((r) => setTimeout(r, 50));
  return m.lastElementChild.id;
});
assert.equal(last, "cw-menu-entry", "魔棒菜单里始终在最下面");
await page.screenshot({ path: SHOTS + "s-settings.png", fullPage: true });
await done("设置框检查通过");
