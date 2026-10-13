// 缝合目标：缝在两条中间、组开头、缝成新分组
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1.5, hasTouch: true });
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => window.__presetAtelier.open("suture")); await page.waitForTimeout(400);
const T = "众生相-真实版";
await page.selectOption(".pa-dst-picker select", T); await page.waitForTimeout(300);
await page.selectOption(".pa-src-pick select", "V2.61"); await page.waitForTimeout(400);
const pickSrc = (re) => page.evaluate((re) => { const r = [...document.querySelectorAll(".pa-src-list .pa-row")].find((x) => new RegExp(re).test(x.textContent)); r.click(); return r.textContent.trim().slice(0, 16); }, re);
console.log("src", await pickSrc("文物修复师"));
const where = () => page.evaluate(() => document.querySelector(".pa-where").textContent);
// 展开第 3 个组，点第 2 条
await page.evaluate(() => document.querySelectorAll(".pa-dst-list .pa-ghead .pa-gname")[2].click()); await page.waitForTimeout(200);
const g3 = await page.evaluate(() => { const sec = document.querySelectorAll(".pa-dst-list .pa-group")[2]; sec.querySelectorAll(".pa-row")[1].click(); return sec.querySelector(".pa-gname").textContent; });
await page.waitForTimeout(200);
console.log("between:", await where());
await page.screenshot({ path: "test/shots/t-1-between.png" });
await page.evaluate(() => document.querySelectorAll(".pa-dst-list .pa-group")[2].querySelector('[data-act="gstart"]').click()); await page.waitForTimeout(200);
console.log("start:", await where());
// 新分组
await page.click('.pa-dst-list [data-act="ng-new"]'); await page.waitForTimeout(300);
await page.fill(".pa-sheet input.pa-input", "缝来的修复"); await page.click(".pa-sheet .pa-btn-primary"); await page.waitForTimeout(300);
console.log("ng after start:", await where());
await page.evaluate(() => { const sec = document.querySelectorAll(".pa-dst-list .pa-group")[2]; sec.querySelectorAll(".pa-row")[1].click(); }); await page.waitForTimeout(200);
console.log("ng in group:", await where());
await page.screenshot({ path: "test/shots/t-2-newgroup.png" });
await page.click('[data-st="go"]'); await page.waitForTimeout(700);
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(1500);
const r = await page.evaluate(({ T, g3 }) => {
  const i = window.__mock.names.indexOf(T); const p = window.__mock.presets[i];
  const bb = p.extensions?.baibaiToolkit?.presetPromptGroups;
  const ng = bb.groups.find((g) => g.name === "缝来的修复");
  const order = p.prompt_order.find((o) => o.character_id == 100001).order.map((o) => o.identifier);
  const gidOf = (id) => bb.prompts[id]?.groupId;
  const mem = order.filter((id) => gidOf(id) === ng?.id);
  const k = order.indexOf(mem[0]);
  const prevG = bb.groups.find((g) => g.id === gidOf(order[k - 1]))?.name;
  return { ng: !!ng, members: mem.map((id) => p.prompts.find((x) => x.identifier === id)?.name), prevGroup: prevG, g3: g3.trim() };
}, { T, g3 });
console.log(JSON.stringify(r));
await page.screenshot({ path: "test/shots/t-3-done.png" });
console.log(errs.length ? errs : "no page errors");
await browser.close();
