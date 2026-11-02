// 2.5.10 站点导入、导出（JSON 文件）：认别处常见的写法；导出含密钥；再导入同名同网址的站点是更新，密钥一样就不重复存；
// 站点丢了密钥时，导入文件补回来。先构建并在仓库根目录运行 8765 静态服务。
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errs = [];
const ok = (m) => console.log("✓", m);
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8765/test/site/index.html");
  await page.waitForFunction(() => window.__presetAtelier?.open);
  const S = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier);
  const vault = () => page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.length);
  const toasts = () => page.evaluate(() => window.__toasts.splice(0));
  await page.evaluate(() => {
    window.__toasts = [];
    window.toastr = Object.fromEntries(["success", "info", "warning", "error"].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
    window.SillyTavern.getContext().extensionSettings.presetAtelier = { sites: [], activeSiteId: null };
    window.__presetAtelier.open("more", "schemes");
  });
  await page.waitForTimeout(400);
  const importFile = async (name, text) => {
    await page.setInputFiles("[data-import-sites]", { name, mimeType: "application/json", buffer: Buffer.from(text) });
    await page.waitForTimeout(300);
  };

  // 1) 别处的写法：数组、baseUrl / apiKey、api_url + keys
  assert.equal(await page.locator('[data-a="exportsites"]').count(), 0, "没有站点时不显示导出");
  await importFile("my-apis.json", JSON.stringify([
    { name: "A站", baseUrl: "https://a.example.com/v1", apiKey: "sk-aaaa1111", model: "m1", models: ["m1", "m2"], remark: "月卡" },
    { title: "B站", api_url: "https://b.example.com/v1/", keys: [{ name: "按次", key: "sk-bbbb0001" }, { name: "按量", key: "sk-bbbb0002" }] },
    { name: "不是站点", foo: 1 }
  ]));
  const rows = await page.locator(".pa-imp-row").allTextContents();
  assert.equal(rows.length, 2, rows.join("|"));
  assert.match(rows[0], /A站.*新增.*a\.example\.com.*1 个密钥/);
  assert.match(rows[1], /B站.*新增.*2 个密钥/);
  await page.click(".pa-sheet-actions >> text=导入"); await page.waitForTimeout(400);
  let s = await S();
  assert.equal(s.sites.length, 2);
  const [a, b] = s.sites;
  assert.deepEqual([a.name, a.url, a.model, a.models, a.note, a.keyMask, !!a.secretId], ["A站", "https://a.example.com/v1", "m1", ["m1", "m2"], "月卡", "sk-…1111", true]);
  assert.deepEqual(b.keys.map((k) => [k.name, k.keyMask, !!k.secretId]), [["按次", "sk-…0001", true], ["按量", "sk-…0002", true]]);
  assert.equal(await vault(), 3);
  assert.match((await toasts()).join("|"), /新增 2 个/);
  ok("导入别处写法的文件：预览后新增两个站点，密钥存进密钥库");

  // 2) 导出（含密钥）
  await page.click('[data-a="exportsites"]'); await page.waitForTimeout(200);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".pa-pick-item >> text=含密钥")]);
  assert.match(dl.suggestedFilename(), /^api-sites-\d{8}-\d{4}\.json$/);
  const text = fs.readFileSync(await dl.path(), "utf8");
  const file = JSON.parse(text);
  assert.equal(file.format, "焦香鸡翅-站点");
  assert.deepEqual(file.sites.map((x) => [x.name, x.url, x.keys.map((k) => k.key).join(",")]), [["A站", "https://a.example.com/v1", "sk-aaaa1111"], ["B站", "https://b.example.com/v1/", "sk-bbbb0001,sk-bbbb0002"]]);
  ok("导出含密钥：文件里是全文密钥、网址、模型");

  // 3) 再导入同一个文件：同名同网址是更新，密钥一样不重复存
  await importFile("back.json", text);
  assert.match((await page.locator(".pa-imp-row").allTextContents()).join("|"), /A站更新.*B站更新/);
  await page.click(".pa-sheet-actions >> text=导入"); await page.waitForTimeout(400);
  s = await S();
  assert.equal(s.sites.length, 2);
  assert.equal(await vault(), 3, "密钥一样，不重复存");
  assert.equal(s.sites[0].secretId, a.secretId);
  ok("再导入：更新已有站点，不重复存密钥");

  // 4) 站点丢了密钥（如更新后要重填）：导入补回来
  await page.evaluate(() => { const x = window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0]; x.secretId = null; x.keyMask = ""; });
  await importFile("back.json", text);
  await page.click(".pa-sheet-actions >> text=导入"); await page.waitForTimeout(400);
  s = await S();
  assert.ok(s.sites[0].secretId && s.sites[0].keyMask === "sk-…1111");
  assert.equal(await vault(), 4);
  ok("站点没了密钥：导入后补回");

  // 5) 不是 JSON、没有站点
  await importFile("bad.json", "not json");
  assert.match((await toasts()).join("|"), /error:不是 JSON 文件/);
  await importFile("empty.json", JSON.stringify({ hello: "world" }));
  assert.match((await toasts()).join("|"), /没找到站点/);
  ok("坏文件、没有站点的文件给出提示");
} finally {
  await browser.close();
}
assert.deepEqual(errs, []);
