// 2.6.19 站点余额：按网址认出接口、读出余额。用法：node test/balance-core.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const f = new Function(fs.readFileSync(path.join(__dirname, '../src/core/balance.js'), 'utf8') + '\nreturn { balancePlan, balanceRead, balanceMoney, balanceAgo, balanceManual, balanceParseAmount };')();
let passed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}
const NOW = new Date('2026-11-04T10:00:00Z');
test('the balance endpoint is chosen by the site address', () => {
  assert.deepEqual(f.balancePlan({ source: 'custom', url: 'https://relay.example.com/v1/' }, NOW), { kind: 'relay', urls: ['https://relay.example.com/v1/dashboard/billing/subscription', 'https://relay.example.com/v1/dashboard/billing/usage?start_date=2026-07-28&end_date=2026-11-05'] });
  assert.deepEqual(f.balancePlan({ source: 'deepseek' }), { kind: 'deepseek', urls: ['https://api.deepseek.com/user/balance'] });
  assert.deepEqual(f.balancePlan({ source: 'custom', url: 'https://api.deepseek.com/v1' }).urls, ['https://api.deepseek.com/user/balance']);
  assert.equal(f.balancePlan({ source: 'openrouter' }).kind, 'openrouter');
  assert.deepEqual(f.balancePlan({ source: 'custom', url: 'https://api.siliconflow.cn/v1' }), { kind: 'siliconflow', urls: ['https://api.siliconflow.cn/v1/user/info'], cny: true });
  assert.deepEqual(f.balancePlan({ source: 'custom', url: 'https://api.moonshot.cn/v1' }), { kind: 'moonshot', urls: ['https://api.moonshot.cn/v1/users/me/balance'], cny: true });
  for (const site of [{ source: 'openai' }, { source: 'claude' }, { source: 'makersuite' }, { source: 'custom', url: 'https://api.openai.com/v1' }]) assert.equal(f.balancePlan(site).none, '官方接口不提供余额查询');
  assert.equal(f.balancePlan({ source: 'custom', url: '' }).none, '没有网址');
  assert.equal(f.balancePlan({ source: 'custom', url: 'not a url' }).none, '网址不对');
});
test('relay balance is the limit minus usage; unlimited keys say so', () => {
  const relay = { kind: 'relay' };
  assert.deepEqual(f.balanceRead(relay, [{ hard_limit_usd: 50 }, { total_usage: 1234 }]), { ok: true, text: '$37.66', sub: '总额度 $50.00，已用 $12.34', used: 12.34 });
  assert.deepEqual(f.balanceRead(relay, [{ hard_limit_usd: 100000000 }, { total_usage: 500 }]), { ok: true, text: '不限额', sub: '这个密钥已用 $5.00；可手填账户余额', used: 5 });
  assert.deepEqual(f.balanceRead(relay, [{ hard_limit_usd: 20 }, null]), { ok: true, text: '$20.00', sub: '总额度，用量没查到', used: null });
  assert.deepEqual(f.balanceRead(relay, [null]), { ok: false, text: '站点不提供查询', why: '这个中转站没有开放余额接口，或密钥失效' });
});
test('provider balances are read from their own shapes', () => {
  assert.deepEqual(f.balanceRead({ kind: 'deepseek' }, [{ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00' }] }]), { ok: true, text: '¥110.00', sub: '' });
  assert.equal(f.balanceRead({ kind: 'deepseek' }, [{ is_available: false, balance_infos: [{ currency: 'USD', total_balance: '0.00' }] }]).sub, '余额不足，暂不可用');
  assert.deepEqual(f.balanceRead({ kind: 'openrouter' }, [{ data: { total_credits: 20, total_usage: 7.5 } }]), { ok: true, text: '$12.50', sub: '已用 $7.50' });
  assert.equal(f.balanceRead({ kind: 'openrouter' }, [null, { data: { limit: null, usage: 3 } }]).text, '不限额');
  assert.equal(f.balanceRead({ kind: 'openrouter' }, [null, { data: { limit: 10, usage: 4, limit_remaining: 6 } }]).text, '$6.00');
  assert.equal(f.balanceRead({ kind: 'siliconflow', cny: true }, [{ code: 20000, data: { balance: '1.00', totalBalance: '15.5' } }]).text, '¥15.50');
  assert.equal(f.balanceRead({ kind: 'moonshot', cny: false }, [{ code: 0, data: { available_balance: 49.58 } }]).text, '$49.58');
  assert.deepEqual(f.balanceRead({ kind: 'moonshot' }, [{}]), { ok: false, text: '没查到', why: '站点没有返回余额，可能是密钥失效或站点不提供' });
});
test('amounts and times read naturally', () => {
  assert.equal(f.balanceMoney(1234.5), '$1,234.50');
  assert.equal(f.balanceMoney(123.456), '$123.46');
  assert.equal(f.balanceMoney(-2), '-$2.00');
  const now = Date.parse('2026-11-04T10:00:00Z');
  assert.deepEqual([30e3, 5 * 60e3, 3 * 3600e3, 30 * 3600e3, 4 * 86400e3].map((d) => f.balanceAgo(now - d, now)), ['刚刚', '5 分钟前', '3 小时前', '昨天', '4 天前']);
});
// 2.6.20 手填账户余额：按各密钥此后多用的扣减
test('a hand-entered account balance is reduced by what each key used since', () => {
  const manual = { amount: 50, base: { a: { used: 5, sec: 'id1' }, b: { used: 1, sec: 'id2' } } };
  const r = f.balanceManual(manual, [{ kid: 'a', sec: 'id1', used: 8.2 }, { kid: 'b', sec: 'id2', used: 1.5 }]);
  assert.equal(Math.round(r.remain * 100) / 100, 46.3);
  assert.equal(r.missing, 0);
  assert.equal(f.balanceManual(manual, [{ kid: 'a', sec: 'id9', used: 0.4 }]).spent, 0.4, '换了密钥：新令牌从 0 算');
  assert.equal(f.balanceManual(manual, [{ kid: 'a', sec: 'id1', used: 2 }]).spent, 2, '用量比起点少（令牌重建）：从 0 算');
  assert.deepEqual(f.balanceManual(manual, [{ kid: 'a', sec: 'id1', used: null }, { kid: 'c', sec: 'x', used: 3 }]), { remain: 50, spent: 0, missing: 2 }, '查不到用量、还没起点的不扣');
  assert.deepEqual(['50', '$50.5', '¥1,200', ' 30 元', '12.', 'abc', '-3', ''].map(f.balanceParseAmount), [50, 50.5, 1200, 30, null, null, null, null]);
});
console.log(`${passed} balance tests passed`);
