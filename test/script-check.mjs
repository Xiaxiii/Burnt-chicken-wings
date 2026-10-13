import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const mode of ["script", "both"]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  page.on("pageerror", (e) => logs.push("ERR " + e.message));
  await page.goto(`http://127.0.0.1:8765/test/site/script.html?mode=${mode}`);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => ({ kind: window.__presetAtelier.kind, version: window.__presetAtelier.version, menus: document.querySelectorAll("#pa-menu-entry").length, styles: document.querySelectorAll("#pa-style").length }));
  console.log(mode, JSON.stringify(info), logs.filter((l) => /裁缝铺|ERR/.test(l)).join(" | "));
  await page.close();
}
await browser.close();
