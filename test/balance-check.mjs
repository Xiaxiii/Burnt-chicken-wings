// 2.6.19 站点余额：打开方案页时查当前连接的余额（10 分钟内不重复查）；钱包按钮逐个查全部站点；
// 请求经酒馆 /status 接口，网址末尾带 #；本浏览器有密钥副本时放进请求头，没有时按密钥库编号用，查完换回原来的密钥。
// 先构建并在仓库根目录运行 8765 静态服务。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  const asked = [];
  await page.route('**/api/backends/chat-completions/status', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    asked.push(body);
    const u = String(body.custom_url || '');
    const json = u.startsWith('https://relay.example.com/v1/dashboard/billing/subscription') ? { object: 'billing_subscription', hard_limit_usd: 50 }
      : u.startsWith('https://relay.example.com/v1/dashboard/billing/usage') ? { object: 'list', total_usage: 1234 }
      : u.startsWith('https://free.example.com/v1/dashboard/billing/subscription') ? { hard_limit_usd: 100000000 }
      : u.startsWith('https://free.example.com/v1/dashboard/billing/usage') ? { total_usage: 500 }
      : u === 'https://api.deepseek.com/user/balance#' ? { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00' }] }
      : { error: true, data: { data: [] } };
    await r.fulfill({ json });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(async () => {
    window.__toasts = [];
    window.toastr = Object.fromEntries(['success', 'info', 'warning', 'error'].map((k) => [k, (m) => window.__toasts.push(`${k}:${m}`)]));
    const sec = await import('/test/site/scripts/secrets.js');
    sec.secret_state.api_key_custom.push({ id: 'id1', value: 'lay', active: true }, { id: 'id2', value: 'bad', active: false });
    localStorage.setItem('presetAtelier:keycopy:default-user:id1', 'sk-relay');
    localStorage.setItem('presetAtelier:key:default-user:s2', 'sk-ds');
    localStorage.setItem('presetAtelier:key:default-user:s4', 'sk-free');
    window.__mock.live.custom_url = 'https://relay.example.com/v1';
    window.SillyTavern.getContext().extensionSettings.presetAtelier = { activeSiteId: 's1', sites: [
      { id: 's1', name: '中转A', source: 'custom', url: 'https://relay.example.com/v1', model: 'claude-x', models: [], secretId: 'id1', keyMask: 'sk-…lay' },
      { id: 's2', name: 'DeepSeek', source: 'deepseek', model: 'deepseek-chat', models: [], localKey: true },
      { id: 's3', name: 'OpenAI 官方', source: 'openai', model: 'gpt-x', models: [] },
      { id: 's4', name: '公益站', source: 'custom', url: 'https://free.example.com/v1', model: 'm', models: [], localKey: true },
      { id: 's5', name: '坏站', source: 'custom', url: 'https://bad.example.com/v1', model: 'm', models: [], secretId: 'id2' }
    ] };
    window.__presetAtelier.open('more', 'schemes');
  });
  const bal = page.locator('.pa-live .pa-live-bal');
  await page.waitForFunction(() => document.querySelector('.pa-live .pa-live-bal b'));
  assert.equal((await bal.innerText()).replace(/\s+/g, ' ').trim(), '余额 $37.66 总额度 $50.00，已用 $12.34 · 刚刚');
  assert.equal(asked.length, 2, '中转站问额度和用量两次');
  assert.ok(asked.every((b) => b.chat_completion_source === 'custom' && b.custom_url.endsWith('#')), '网址末尾带 #，酒馆接上的 /models 不发出去');
  assert.ok(asked.every((b) => b.custom_include_headers === JSON.stringify({ Authorization: 'Bearer sk-relay' }) && !b.secret_id), '有密钥副本时放进请求头');
  assert.match(asked[1].custom_url, /^https:\/\/relay\.example\.com\/v1\/dashboard\/billing\/usage\?start_date=\d{4}-\d\d-\d\d&end_date=\d{4}-\d\d-\d\d#$/);
  ok('打开方案页时查当前连接的余额：额度减用量，经酒馆后端、用这个站点的密钥');

  // 重新打开：10 分钟内不重复查；点 ↻ 重新查
  await page.evaluate(() => { window.__presetAtelier.open('cot'); window.__presetAtelier.open('more', 'schemes'); });
  await page.locator('.pa-live .pa-live-bal b').waitFor();
  await page.waitForTimeout(300);
  assert.equal(asked.length, 2, '10 分钟内不重复查');
  await page.click('.pa-live [data-a=balance]');
  await page.waitForFunction((n) => window.__presetAtelier && document.querySelector('.pa-live .pa-live-bal b'), 4);
  await page.waitForTimeout(300);
  assert.equal(asked.length, 4, '点 ↻ 重新查');
  ok('10 分钟内重新打开不重复查，点 ↻ 重新查');

  // 钱包：逐个查全部站点；官方接口跳过；没有副本的按密钥库编号用，查完换回原来的密钥
  asked.length = 0;
  await page.click('[data-a=balanceall]');
  await page.waitForFunction(() => window.__toasts.some((t) => t.includes('个余额')));
  assert.ok((await page.evaluate(() => window.__toasts)).includes('warning:已查 3 个余额，1 个没查到，1 个官方接口不提供'));
  const info = (id) => page.locator(`.pa-plan-sites .pa-site[data-id=${id}] .pa-site-model`).innerText();
  assert.match(await info('s1'), /余额 \$37\.66/);
  assert.match(await info('s2'), /余额 ¥110\.00/);
  assert.match(await info('s4'), /余额 不限额/);
  assert.doesNotMatch(await info('s3'), /余额/);
  assert.doesNotMatch(await info('s5'), /余额/);
  const ds = asked.find((b) => b.custom_url.includes('deepseek'));
  assert.equal(ds.custom_include_headers, JSON.stringify({ Authorization: 'Bearer sk-ds' }), 'DeepSeek 站点用本浏览器里的密钥');
  const badReq = asked.filter((b) => b.custom_url.includes('bad.example.com'));
  assert.equal(badReq.length, 1, '额度没查到就不再问用量');
  assert.equal(badReq[0].secret_id, 'id2', '没有密钥副本时按密钥库编号用');
  assert.equal(badReq[0].custom_include_headers, undefined);
  assert.ok(!asked.some((b) => b.custom_url.includes('openai')), '官方接口不发请求');
  const active = await page.evaluate(async () => (await import('/test/site/scripts/secrets.js')).secret_state.api_key_custom.find((x) => x.active)?.id);
  assert.equal(active, 'id1', '查完换回原来在用的密钥');
  const saved = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.balances);
  assert.equal(saved.s5.ok, false);
  assert.ok(!JSON.stringify(saved).includes('sk-'), '设置里只记余额，不记密钥');
  ok('钱包按钮逐个查全部站点：中转站、DeepSeek、不限额令牌；官方接口跳过；查完换回原来的密钥');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
