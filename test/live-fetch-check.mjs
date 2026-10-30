// 2.4.1 当前连接：模型旁的「拉取」「测试」；拉取到列表后模型框才出现 ▾。先构建并在仓库根目录运行 8765 静态服务。
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
  assert.equal(await page.locator('.pa-live [data-a=reconnect]').innerText(), '测试');
  ok('模型旁有拉取和测试，没拉取时模型框没有 ▾');

  await page.click('[data-a=livefetch]');
  await page.locator('.pa-live .pa-model-btn i').waitFor();
  assert.deepEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].models), ['claude-x', 'claude-y', 'gemini-z'], '拉取到的列表记进使用中的站点');
  await page.click('[data-a=livemodel]');
  await page.locator('.pa-mpick-item').first().waitFor();
  assert.equal(await page.locator('.pa-mpick-item').count(), 3, '点 ▾ 列出全部模型');
  await page.locator('.pa-sheet-x').last().click();
  ok('拉取后出现 ▾，点开是全部模型');

  await page.click('.pa-live [data-a=reconnect]');
  await page.waitForFunction(() => window.__toasts.some((t) => /连接/.test(t)), null, { timeout: 20000 });
  ok('点测试重新连接并提示结果');

  await page.click('[data-a=livemore]');
  const acts = await page.locator('.pa-sheet-actions .pa-btn').allInnerTexts();
  assert.deepEqual(acts, ['删除', '编辑'], '⋯ 里不再放重新连接和获取模型列表');
  ok('⋯ 里只留编辑、删除');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
