// 2.4.0 当前连接：模型旁的「拉取」「测试」；拉取到列表后模型框才出现 ▾。先构建并在仓库根目录运行 8765 静态服务。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/backends/chat-completions/status', (r) => r.fulfill({ json: { data: [{ id: 'claude-x' }, { id: 'claude-y' }, { id: 'gemini-z' }] } }));
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(() => {
    window.__toasts = [];
    window.toastr = Object.fromEntries(['success', 'info', 'warning', 'error'].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
    const s = window.SillyTavern.getContext().extensionSettings;
    s.presetAtelier = { sites: [{ id: 's1', name: '中转A', source: 'custom', url: 'https://example.com/v1', model: 'claude-x', models: [], keyMask: 'sk-…L3a' }], activeSiteId: 's1' };
    window.__presetAtelier.open('more', 'schemes');
  });
  const arrow = () => page.locator('.pa-live .pa-model-btn i').count();
  await page.locator('[data-a=livefetch]').waitFor();
  assert.equal(await arrow(), 0, '没有模型列表时不显示 ▾');
  assert.equal(await page.locator('.pa-live [data-a=testmodel]').getAttribute('aria-label'), '发送测试消息');
  assert.equal(await page.locator('.pa-plan-sites .pa-optgroup').count(), 0, '站点那块只放站点');
  assert.equal(await page.locator('.pa-plan-opts .pa-optgroup').count(), 2, '两个选项在方案下面');
  ok('模型旁有拉取和测试，没拉取时模型框没有 ▾');

  await page.click('[data-a=livefetch]');
  await page.locator('.pa-live .pa-model-btn i').waitFor();
  assert.deepEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].models), ['claude-x', 'claude-y', 'gemini-z'], '拉取到的列表记进使用中的站点');
  await page.click('[data-a=livemodel]');
  await page.locator('.pa-mpick-item').first().waitFor();
  assert.equal(await page.locator('.pa-mpick-item').count(), 3, '点 ▾ 列出全部模型');
  await page.locator('.pa-sheet-x').last().click();
  ok('拉取后出现 ▾，点开是全部模型');

  // 2.5.0 测试：用选中的模型发一句「Hi」，回了就算能用；失败时第二行用最简单的话解释状态码
  let reply = { status: 200, json: { choices: [{ message: { content: 'Hello!  How can I help?' } }] } };
  const sent = [];
  await page.route('**/api/backends/chat-completions/generate', (r) => { sent.push(JSON.parse(r.request().postData())); r.fulfill({ status: reply.status, json: reply.json }); });
  await page.evaluate(() => {
    const c = window.SillyTavern.getContext();
    c.getChatCompletionModel = () => 'claude-y';
    c.ChatCompletionService = { presetToGeneratePayload: async (a, b, o) => ({ ...o }) };
  });
  const res = () => page.locator('.pa-live .pa-live-res').textContent();
  await page.click('.pa-live [data-a=testmodel]');
  await page.locator('.pa-live .pa-live-res.ok').waitFor({ timeout: 10000 });
  assert.equal(sent[0].model, 'claude-y', '用酒馆里选中的模型');
  assert.deepEqual(sent[0].messages, [{ role: 'user', content: 'Hi' }]);
  assert.equal(await res(), 'Successful');
  // 503：中转站把上游的报错塞在 message 里
  reply = { status: 503, json: { error: { message: JSON.stringify({ error: { message: 'Service Unavailable', type: 'upstream_error' } }) } } };
  await page.click('.pa-live [data-a=testmodel]');
  await page.locator('.pa-live .pa-live-res.bad').waitFor({ timeout: 10000 });
  assert.equal(await res(), '503 暂无可用渠道');
  assert.equal(await page.locator('.pa-live .pa-live-res').getAttribute('title'), 'Service Unavailable', '原文放在悬停提示里');
  // 酒馆回 500，报错文字里写着 504
  reply = { status: 500, json: { error: { message: 'Got response status 504 Gateway Timeout' } } };
  await page.click('.pa-live [data-a=testmodel]');
  await page.waitForFunction(() => document.querySelector('.pa-live .pa-live-res')?.textContent === '504 上游超时', null, { timeout: 10000 });
  // 酒馆回 200，报错里只有英文说法：认成 503，显示中文
  reply = { status: 200, json: { error: { message: 'Service Unavailable' } } };
  await page.click('.pa-live [data-a=testmodel]');
  await page.waitForFunction(() => document.querySelector('.pa-live .pa-live-res')?.textContent === '503 暂无可用渠道', null, { timeout: 10000 });
  // 认不出的：只写「未知错误」，点这一行看原文
  reply = { status: 200, json: { error: { message: 'something weird happened' } } };
  await page.click('.pa-live [data-a=testmodel]');
  await page.waitForFunction(() => document.querySelector('.pa-live .pa-live-res')?.textContent === '未知错误', null, { timeout: 10000 });
  await page.click('.pa-live .pa-live-res');
  await page.waitForFunction(() => window.__toasts.includes('info:原文：something weird happened'));
  // 报错里写着额度不足
  reply = { status: 429, json: { error: { message: 'insufficient_quota: You exceeded your current quota' } } };
  await page.click('.pa-live [data-a=testmodel]');
  await page.waitForFunction(() => document.querySelector('.pa-live .pa-live-res')?.textContent === '429 额度不足', null, { timeout: 10000 });
  assert.ok(!(await page.evaluate(() => window.__toasts.some((t) => /测试失败|可以用/.test(t)))), '不另弹提示');
  ok('点测试发送测试消息，结果写在模型下面一行');

  await page.click('[data-a=livemore]');
  const acts = await page.locator('.pa-sheet-actions .pa-btn').allInnerTexts();
  assert.deepEqual(acts, ['删除', '编辑'], '⋯ 里不再放重新连接和获取模型列表');
  ok('⋯ 里只留编辑、删除');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
