// 2.6.19 站点余额：打开方案页时查当前连接的余额（10 分钟内不重复查）；钱包按钮逐个查全部站点；
// 请求经酒馆 /status 接口，网址末尾带 #；本浏览器有密钥副本时放进请求头，没有时按密钥库编号用，查完换回原来的密钥。
// 2.6.20 不限额的令牌手填账户余额，之后按站点查到的用量扣减；充值后改余额重新起算；可不再手填；编辑窗口也能填。
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
  let freeUsage = 500;
  const multiUsage = { 'sk-m1': 300, 'sk-m2': 100 };
  await page.route('**/api/backends/chat-completions/status', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    asked.push(body);
    const u = String(body.custom_url || '');
    const json = u.startsWith('https://relay.example.com/v1/dashboard/billing/subscription') ? { object: 'billing_subscription', hard_limit_usd: 50 }
      : u.startsWith('https://relay.example.com/v1/dashboard/billing/usage') ? { object: 'list', total_usage: 1234 }
      : u.startsWith('https://free.example.com/v1/dashboard/billing/subscription') ? { hard_limit_usd: 100000000 }
      : u.startsWith('https://free.example.com/v1/dashboard/billing/usage') ? { total_usage: freeUsage }
      : u.startsWith('https://multi.example.com/v1/dashboard/billing/subscription') ? { hard_limit_usd: 100000000 }
      : u.startsWith('https://multi.example.com/v1/dashboard/billing/usage') ? { total_usage: multiUsage[JSON.parse(body.custom_include_headers).Authorization.slice(7)] }
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
    window.__presetAtelier.open('conn');
  });
  const bal = page.locator('.cw-live .cw-bal');
  await page.waitForFunction(() => document.querySelector('.cw-live .cw-bal b'));
  assert.equal((await bal.innerText()).replace(/\s+/g, ' ').trim(), '余额 $37.66 总额度 $50.00，已用 $12.34 · 刚刚');
  assert.equal(asked.length, 2, '中转站问额度和用量两次');
  assert.ok(asked.every((b) => b.chat_completion_source === 'custom' && b.custom_url.endsWith('#')), '网址末尾带 #，酒馆接上的 /models 不发出去');
  assert.ok(asked.every((b) => b.custom_include_headers === JSON.stringify({ Authorization: 'Bearer sk-relay' }) && !b.secret_id), '有密钥副本时放进请求头');
  assert.match(asked[1].custom_url, /^https:\/\/relay\.example\.com\/v1\/dashboard\/billing\/usage\?start_date=\d{4}-\d\d-\d\d&end_date=\d{4}-\d\d-\d\d#$/);
  ok('打开方案页时查当前连接的余额：额度减用量，经酒馆后端、用这个站点的密钥');

  // 重新打开：10 分钟内不重复查；点 ↻ 重新查
  await page.evaluate(() => { window.__presetAtelier.open('cot'); window.__presetAtelier.open('conn'); });
  await page.locator('.cw-live .cw-bal b').waitFor();
  await page.waitForTimeout(300);
  assert.equal(asked.length, 2, '10 分钟内不重复查');
  await page.click('.cw-live [data-act=balance]');
  await page.waitForFunction((n) => window.__presetAtelier && document.querySelector('.cw-live .cw-bal b'), 4);
  await page.waitForTimeout(300);
  assert.equal(asked.length, 4, '点 ↻ 重新查');
  ok('10 分钟内重新打开不重复查，点 ↻ 重新查');

  // 钱包：逐个查全部站点；官方接口跳过；没有副本的按密钥库编号用，查完换回原来的密钥
  asked.length = 0;
  await page.click('[data-act=balanceall]');
  await page.waitForFunction(() => window.__toasts.some((t) => t.includes('个余额')));
  assert.ok((await page.evaluate(() => window.__toasts)).includes('warning:已查 3 个余额，1 个没查到，1 个官方接口不提供'));
  const info = (id) => page.locator(`[data-r=sites] .cw-site[data-id=${id}] .cw-site-main small`).innerText();
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

  // 不限额令牌：手填账户余额，按此后的用量扣减
  const pick = (text) => page.locator('#cw-root .cw-layer .cw-menu-item', { hasText: text }).first().click();
  const reopen = () => page.evaluate(() => { window.__presetAtelier.open('cot'); window.__presetAtelier.open('conn'); });
  await page.evaluate(() => {
    window.SillyTavern.getContext().extensionSettings.presetAtelier.activeSiteId = 's4';
    window.__mock.live.custom_url = 'https://free.example.com/v1';
  });
  await reopen();
  await page.locator('.cw-live [data-act=balanceset]').waitFor();
  const line = async () => (await bal.innerText()).replace(/\s+/g, ' ').trim();
  assert.equal(await line(), '余额 不限额 这个密钥已用 $5.00；可手填账户余额 · 刚刚 填余额');
  const prompt = async (value) => {
    const sheet = page.locator('.cw-dlg').last();
    await sheet.locator('input.cw-input').fill(value);
    await sheet.locator('.cw-btn-primary').click();
  };
  await page.click('.cw-live [data-act=balanceset]');
  await prompt('$50');
  await page.waitForFunction(() => /手填 \$50\.00/.test(document.querySelector('.cw-live .cw-bal')?.textContent || '') && !document.querySelector('.cw-live .cw-bal .cw-hint'));
  assert.equal(await line(), '余额 $50.00 手填 $50.00 · 之后用了 $0.00 · 刚刚 改余额');
  freeUsage = 820;
  await page.click('.cw-live [data-act=balance]');
  await page.waitForFunction(() => /\$46\.80/.test(document.querySelector('.cw-live .cw-bal')?.textContent || ''));
  assert.equal(await line(), '余额 $46.80 手填 $50.00 · 之后用了 $3.20 · 刚刚 改余额');
  assert.match(await info('s4'), /余额 \$46\.80/);
  ok('不限额令牌手填 $50：之后用了 $3.20，余额 $46.80；站点小字同步');

  // 充值后改余额：按现在的用量重新起算；不再手填：回到查到的结果
  await page.click('.cw-live [data-act=balanceset]');
  await pick('改余额');
  await prompt('100');
  await page.waitForFunction(() => /手填 \$100\.00/.test(document.querySelector('.cw-live .cw-bal')?.textContent || '') && !document.querySelector('.cw-live .cw-bal .cw-hint'));
  assert.equal(await line(), '余额 $100.00 手填 $100.00 · 之后用了 $0.00 · 刚刚 改余额');
  freeUsage = 1000;
  await page.click('.cw-live [data-act=balance]');
  await page.waitForFunction(() => /\$98\.20/.test(document.querySelector('.cw-live .cw-bal')?.textContent || ''));
  await page.click('.cw-live [data-act=balanceset]');
  await pick('不再手填');
  await page.waitForFunction(() => /不限额/.test(document.querySelector('.cw-live .cw-bal')?.textContent || ''));
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites.find((x) => x.id === 's4').manualBalance), undefined);
  ok('充值后改余额重新起算；不再手填后回到查到的结果');

  // 编辑窗口填账户余额：保存后按现在的用量起算；填的不是金额时不让保存
  await page.click('[data-r=sites] .cw-site[data-id=s4] [data-act=edit]');
  const field = page.locator('.cw-dlg [data-f=manualbal]');
  await field.fill('三十');
  await page.locator('.cw-dlg .cw-btn-primary', { hasText: '保存' }).click();
  await page.waitForTimeout(200);
  assert.equal(await field.count(), 1, '填的不是金额：窗口不关');
  await field.fill('30');
  await page.locator('.cw-dlg .cw-btn-primary', { hasText: '保存' }).click();
  await page.waitForFunction(() => /手填 \$30\.00/.test(document.querySelector('.cw-live .cw-bal')?.textContent || '') && !document.querySelector('.cw-live .cw-bal .cw-hint'));
  const m = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites.find((x) => x.id === 's4').manualBalance);
  assert.deepEqual([m.amount, m.base.main.used], [30, 10]);
  assert.equal(await line(), '余额 $30.00 手填 $30.00 · 之后用了 $0.00 · 刚刚 改余额');
  ok('编辑窗口填账户余额：保存后按现在的用量起算，填错不让保存');

  // 多密钥站点（同一账户的两个分组）：手填的账户余额按两个分组此后的用量一起扣
  await page.evaluate(() => {
    localStorage.setItem('presetAtelier:key:default-user:m1', 'sk-m1');
    localStorage.setItem('presetAtelier:key:default-user:m2', 'sk-m2');
    const st = window.SillyTavern.getContext().extensionSettings.presetAtelier;
    st.sites.push({ id: 's6', name: '多组站', source: 'custom', url: 'https://multi.example.com/v1', note: '', keyId: 'k1', keys: [
      { id: 'k1', name: '按次', localKey: true, localId: 'm1', model: 'a', models: [] },
      { id: 'k2', name: '按量', localKey: true, localId: 'm2', model: 'b', models: [] }] });
    st.activeSiteId = 's6';
    window.__mock.live.custom_url = 'https://multi.example.com/v1';
  });
  await reopen();
  await page.locator('.cw-live [data-act=balanceset]').waitFor();
  await page.click('.cw-live [data-act=balanceset]');
  await prompt('20');
  await page.waitForFunction(() => /手填 \$20\.00/.test(document.querySelector('.cw-live .cw-bal')?.textContent || '') && !document.querySelector('.cw-live .cw-bal .cw-hint'));
  assert.equal(await line(), '余额 $20.00 手填 $20.00 · 之后用了 $0.00 · 刚刚 改余额');
  multiUsage['sk-m1'] = 450;
  multiUsage['sk-m2'] = 160;
  await page.click('.cw-live [data-act=balance]');
  await page.waitForFunction(() => /\$17\.90/.test(document.querySelector('.cw-live .cw-bal')?.textContent || ''));
  assert.equal(await line(), '余额 $17.90 手填 $20.00 · 之后用了 $2.10 · 刚刚 改余额');
  assert.match(await page.locator('[data-r=sites] .cw-site[data-id=s6] .cw-site-main small').innerText(), /余额 \$17\.90/);
  ok('多密钥站点：两个分组此后的用量一起扣（$1.50 + $0.60），余额 $17.90');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
