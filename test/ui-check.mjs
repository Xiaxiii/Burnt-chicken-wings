// 1.3.7 整理页（点行选中→移动→点位置）、思维链页、API 页、缝合位置标记
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 1, hasTouch: true });
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
await page.evaluate(() => {
  document.body.insertAdjacentHTML("beforeend", '<select id="model_custom_select"><option value="claude-opus">claude-opus</option><option value="claude-sonnet">claude-sonnet</option></select><input id="custom_model_id">');
  const s = window.SillyTavern.getContext().extensionSettings;
  s.presetAtelier = { sites: [{ id: "s1", name: "中转A", source: "custom", url: "https://example.com/v1", model: "claude-x", models: [], keyMask: "sk-…L3a" }], activeSiteId: "s1" };
  window.__presetAtelier.open("organize");
});
await page.waitForTimeout(400);
const T = "众生相-真实版";
await page.selectOption(".pa-picker-slot select", T); await page.waitForTimeout(300);
await page.click("text=全部展开"); await page.waitForTimeout(200);
const names = () => page.evaluate(() => [...document.querySelectorAll(".pa-list .pa-row .pa-name")].map((x) => x.textContent.trim()));
const before = await names();
// 点第 3、4 行（整行）选中
await page.locator(".pa-list .pa-row").nth(3).click(); await page.locator(".pa-list .pa-row").nth(4).click();
const picked = [before[3], before[4]];
console.log("selbar:", await page.evaluate(() => document.querySelector(".pa-selbar").innerText.replace(/\s+/g, " ")));
await page.click('[data-sel="moveto"]'); await page.waitForTimeout(200);
await page.screenshot({ path: "test/shots/u-1-move.png" });
await page.locator(".pa-list .pa-row").nth(10).click(); await page.waitForTimeout(300);
const after = await names();
console.log("moved:", picked, "→ now at", after.indexOf(picked[0]), after.indexOf(picked[1]), "target was", before[10], "at", after.indexOf(before[10]));
// 思维链页
await page.click('[data-tab="cot"]'); await page.waitForTimeout(400);
console.log("cot 设为思维链 buttons:", await page.locator('[data-mark][data-v="1"]').count(), "markpick:", await page.locator("[data-markpick]").count());
await page.screenshot({ path: "test/shots/u-2-cot.png" });
// API 页
await page.click('[data-tab="more"]'); await page.waitForTimeout(200);
await page.click('[data-m="api"]'); await page.waitForTimeout(300);
await page.click(".pa-site > header"); await page.waitForTimeout(200);
await page.screenshot({ path: "test/shots/u-3-api.png" });
await page.selectOption('[data-a="livemodel"]', "claude-sonnet"); await page.waitForTimeout(200);
console.log("live model now:", await page.evaluate(() => [document.getElementById("custom_model_id").value, window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].model]));
// 缝合位置标记
await page.click('[data-tab="suture"]'); await page.waitForTimeout(300);
await page.selectOption(".pa-dst-picker select", T); await page.waitForTimeout(300);
await page.evaluate(() => document.querySelectorAll(".pa-dst-list .pa-ghead .pa-caret")[2].click()); await page.waitForTimeout(150);
await page.evaluate(() => document.querySelectorAll(".pa-dst-list .pa-group")[2].querySelectorAll(".pa-row")[2].click()); await page.waitForTimeout(150);
await page.evaluate(() => document.querySelectorAll(".pa-dst-list .pa-ghead .pa-caret")[2].click()); await page.waitForTimeout(150);
await page.screenshot({ path: "test/shots/u-4-marker-collapsed.png" });
await page.evaluate(() => document.querySelectorAll(".pa-dst-list .pa-ghead .pa-caret")[2].click()); await page.waitForTimeout(150);
await page.screenshot({ path: "test/shots/u-5-marker.png" });
console.log("where:", await page.evaluate(() => document.querySelector(".pa-where").textContent));
console.log(errs.length ? errs : "no page errors");
await browser.close();
