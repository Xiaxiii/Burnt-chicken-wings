// 拉取模型列表时换密钥：直接调酒馆的换密钥接口，不调 rotateSecret（它会让酒馆重新加载预设），拉完换回原来在用的密钥
import assert from "node:assert";
import { start, open, P, catchToasts, toasts, ok } from "./helpers.mjs";
const { page, done } = await start({ width: 390, height: 844, mobile: true });
const rotations = [];
await page.route("**/api/secrets/rotate", async (r) => {
  const { key, id } = JSON.parse(r.request().postData());
  rotations.push(id);
  await page.evaluate(async ({ key, id }) => { const m = await import("/test/site/scripts/secrets.js"); m.secret_state[key].forEach((s) => { s.active = s.id === id; }); }, { key, id });
  await r.fulfill({ status: 200, body: "{}" });
});
await page.route("**/api/backends/chat-completions/status", async (r) => {
  const active = await page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.find((s) => s.active)?.id);
  await r.fulfill({ json: { data: active === "k2" ? [{ id: "b1" }, { id: "b2" }] : [] } });
});
await catchToasts(page);
await page.evaluate(async () => {
  const m = await import("/test/site/scripts/secrets.js");
  m.secret_state.api_key_custom.push({ id: "k1", value: "aaa", active: true }, { id: "k2", value: "bbb", active: false });
  window.SillyTavern.getContext().extensionSettings.presetAtelier = { sites: [{ id: "b", name: "B站", source: "custom", url: "https://b.example/v1", model: "", models: [], secretId: "k2", keyMask: "sk-…bbbb" }], activeSiteId: null };
});
await open(page, "conn");
await page.locator(`${P("conn")} .cw-site .cw-site-main`, { hasText: "B站" }).click(); await page.waitForTimeout(300);
await page.click('#cw-root .cw-dlg [data-act="fetch"]'); await page.waitForTimeout(800);
assert.deepEqual(rotations, ["k2", "k1"], "换到站点的密钥，拉完换回");
assert.equal(await page.evaluate(async () => (await import("/test/site/scripts/secrets.js")).secret_state.api_key_custom.find((s) => s.active)?.id), "k1");
assert.ok((await toasts(page)).includes("success:已获取 2 个模型"));
ok("拉取模型：换密钥走接口，不触发酒馆重新加载预设，拉完换回原密钥");
await done("换密钥检查通过");
