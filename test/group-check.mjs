// 缝合页「整理分组」：在已经有分组的预设里点选条目 → 建新分组，要真的多一个组
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
// 假百宝箱：缓存当前预设的分组，只在「导入完成」时清缓存；别的时候保存都拿缓存盖回去（真百宝箱的行为）
await page.evaluate((T) => {
  const c = window.SillyTavern.getContext();
  c.extensionSettings.baiBaiToolkit = {};
  c.eventTypes.OAI_PRESET_IMPORT_READY = "oai_preset_import_ready";
  const m = window.__mock; const i = m.names.indexOf(T);
  m.live.preset_settings_openai = T; Object.assign(m.live, structuredClone(m.presets[i]));
  let cache = structuredClone(m.live.extensions);
  c.eventSource.on("oai_preset_import_ready", (e) => { if (e.presetName === T) cache = null; window.__bbReset = (window.__bbReset || 0) + 1; });
  c.eventSource.on("oai_after", () => { if (cache) { m.live.extensions = structuredClone(cache); m.presets[i].extensions = structuredClone(cache); } else cache = structuredClone(m.live.extensions); });
  window.__presetAtelier.open("suture");
}, process.argv[2] || "V2.61");
await page.waitForTimeout(400);
const T = process.argv[2] || "V2.61";
await page.waitForTimeout(100);
await page.selectOption(".pa-dst-picker select", T); await page.waitForTimeout(300);
const groups = () => page.evaluate((t) => { const i = window.__mock.names.indexOf(t); const p = window.__mock.presets[i]; return { bb: p.extensions?.baibaiToolkit?.presetPromptGroups?.groups?.map((x) => x.name), eg: p.extensions?.entryGrouping?.map?.((x) => x.name) }; }, T);
console.log("before", JSON.stringify(await groups()));
await page.click('[data-gm="toggle"]'); await page.waitForTimeout(200);
// 展开第一个分组，点里面两条
await page.evaluate(() => document.querySelector(".pa-dst-list .pa-ghead .pa-gname").click()); await page.waitForTimeout(200);
const picked = [];
for (const k of [1, 2]) picked.push(await page.evaluate((k) => { const r = document.querySelectorAll(".pa-dst-list .pa-row")[k]; r.click(); return r.textContent.trim().slice(0, 20); }, k));
await page.waitForTimeout(200);
console.log("picked", picked, await page.evaluate(() => document.querySelector(".pa-gsel-n").textContent));
await page.screenshot({ path: "test/shots/g-1-picked.png" });
await page.click('[data-gm="new"]'); await page.waitForTimeout(300);
await page.screenshot({ path: "test/shots/g-2-prompt.png" });
await page.fill(".pa-sheet input.pa-input", "新组测试"); await page.click(".pa-sheet .pa-btn-primary"); await page.waitForTimeout(2500);
await page.screenshot({ path: "test/shots/g-3-after.png" });
console.log("after", JSON.stringify(await groups()));
console.log("dst heads", await page.evaluate(() => [...document.querySelectorAll(".pa-dst-list .pa-ghead .pa-gname")].map((x) => x.textContent.trim()).join(" | ")));
console.log("bb resets", await page.evaluate(() => window.__bbReset));
// 整组选中 → 应该先问「改名还是建新组」
await page.evaluate(() => document.querySelector('.pa-dst-list .pa-ghead [data-act="gselect"]').click()); await page.waitForTimeout(200);
await page.click('[data-gm="new"]'); await page.waitForTimeout(300);
console.log("whole-group sheet:", await page.evaluate(() => document.querySelector(".pa-sheet")?.innerText.replace(/\s+/g, " ").slice(0, 120)));
await page.screenshot({ path: "test/shots/g-4-whole.png" });
console.log(errs.length ? errs : "no page errors");
await browser.close();
