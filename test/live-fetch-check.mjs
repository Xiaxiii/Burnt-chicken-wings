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
    window.__presetAtelier.open('conn');
  });
  const arrow = () => page.locator('.cw-live .cw-modelbtn .cw-ico').count();
  await page.locator('[data-act=livefetch]').waitFor();
  assert.equal(await arrow(), 0, '没有模型列表时不显示 ▾');
  assert.equal(await page.locator('.cw-live [data-act=testmodel]').getAttribute('aria-label'), '发送测试消息');
  assert.equal(await page.locator('[data-r=sites] .cw-setrow').count(), 0, '站点那块只放站点');
  assert.equal(await page.locator('[data-r=optsbody] .cw-setrow').count(), 2, '两个选项在方案下面');
  ok('模型旁有拉取和测试，没拉取时模型框没有 ▾');

  await page.click('[data-act=livefetch]');
  await page.locator('.cw-live .cw-modelbtn .cw-ico').waitFor();
  assert.deepEqual(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].models), ['claude-x', 'claude-y', 'gemini-z'], '拉取到的列表记进使用中的站点');
  await page.click('[data-act=livemodel]');
  await page.locator('.cw-choice').first().waitFor();
  assert.equal(await page.locator('.cw-choice').count(), 3, '点 ▾ 列出全部模型');
  // 2.5.0 按分类：还没有自建分类时按系列自动分段，当前模型所在的那段展开；选择记在设置里
  await page.locator('.cw-mpick-top .cw-seg [data-view=cat]').click();
  assert.deepEqual(await page.locator('.cw-msec-h b').allTextContents(), ['Claude', 'Gemini']);
  assert.deepEqual(await page.locator('.cw-msec-h').evaluateAll((x) => x.map((y) => y.getAttribute('aria-expanded'))), ['true', 'false'], '展开当前模型所在的系列');
  assert.equal(await page.locator('.cw-choice').count(), 2);
  await page.locator('.cw-msec-h', { hasText: 'Gemini' }).click();
  assert.equal(await page.locator('.cw-choice').count(), 3);
  await page.fill('.cw-mpick input', 'gem');
  await page.waitForTimeout(100);
  assert.deepEqual(await page.locator('.cw-msec-h b').allTextContents(), ['Gemini'], '搜索时只留有结果的系列');
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.modelView), 'cat');
  await page.locator('.cw-dlg-x').last().click();
  // 2.6.8 段落的展开、收起记住最后一次：重新打开时 Gemini 仍展开
  await page.waitForTimeout(250);
  await page.click('[data-act=livemodel]');
  await page.locator('.cw-msec-h').first().waitFor();
  assert.deepEqual(await page.locator('.cw-msec-h').evaluateAll((x) => x.map((y) => y.getAttribute('aria-expanded'))), ['true', 'true'], '重新打开后段落保持最后一次的状态');
  await page.locator('.cw-dlg-x').last().click();
  ok('拉取后出现 ▾，点开是全部模型');

  // 2.5.0 自建分类：多选 → 搜索 → 全选搜索结果 → 新建分类；加入已有分类；编辑模型；改名；删除
  const cats = () => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.sites[0].modelCats || []);
  const heads = () => page.locator('.cw-mpick-list .cw-msec-h b').allTextContents();
  const topSheet = () => page.locator('.cw-dlg').last();
  await page.click('[data-act=livemodel]');
  await page.locator('[data-act=selmode]').click();
  await page.fill('.cw-mpick input', 'claude');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-act=selall]').textContent(), '全选搜索结果（2）');
  await page.locator('[data-act=selall]').click();
  assert.equal(await page.locator('.cw-mpick-cnt').textContent(), '已选 2');
  // 新建分类的名字框可以取消
  await page.locator('.cw-mpick-sel [data-act=newcat]').click();
  await page.locator('.cw-mpick-new [data-act=newcancel]').click();
  assert.ok(await page.locator('.cw-mpick-new').isHidden(), '取消后收起名字框');
  assert.equal(await page.locator('.cw-mpick-cnt').textContent(), '已选 2', '取消不丢勾选');
  assert.equal(await page.locator('[data-act=selmode]').textContent(), '取消多选');
  // 清空：去掉搜索结果里的勾选，再全选回来
  await page.locator('[data-act=selnone]').click();
  assert.equal(await page.locator('.cw-mpick-cnt').textContent(), '已选 0');
  assert.ok(await page.locator('[data-act=selnone]').isHidden(), '没勾选时不显示清空');
  await page.locator('[data-act=selall]').click();
  await page.locator('.cw-mpick-sel [data-act=newcat]').click();
  await page.locator('.cw-mpick-new input').fill('我的 Claude');
  await page.locator('.cw-mpick-new [data-act=newok]').click();
  await page.waitForTimeout(200);
  assert.deepEqual((await cats()).map((c) => [c.name, c.models]), [['我的 Claude', ['claude-x', 'claude-y']]]);
  assert.deepEqual(await heads(), ['我的 Claude', 'Gemini'], '自建分类在前，没分进去的按系列');
  assert.equal(await page.locator('.cw-msec-h', { hasText: 'Gemini' }).locator('small').textContent(), '自动');
  // 加入已有分类：一个模型可以同时在几个分类里，所以先再建一个
  await page.locator('[data-act=selmode]').click();
  // 展开自动段 Gemini（2.6.8 起记住上次的展开状态，前面已展开过就不再点）
  { const g = page.locator('.cw-mpick-list .cw-msec-h', { hasText: 'Gemini' }); if (await g.getAttribute('aria-expanded') !== 'true') await g.click(); }
  await page.locator('.cw-mpick-list [data-sel="gemini-z"]').click();
  await page.locator('.cw-mpick-sel [data-act=newcat]').click();
  await page.locator('.cw-mpick-new input').fill('出图');
  await page.locator('.cw-mpick-new input').press('Enter');
  await page.waitForTimeout(200);
  await page.locator('[data-act=selmode]').click();
  await page.locator('.cw-mpick-list [data-fold="f:Gemini"]').count().then((n) => assert.equal(n, 0, 'gemini-z 进了分类，自动段里没有它'));
  await page.locator('.cw-mpick-list [data-sel="gemini-z"]').click();
  await page.locator('.cw-mpick-sel [data-act=addto]').click();
  await page.locator('#cw-root .cw-layer .cw-menu-item', { hasText: '我的 Claude' }).click();
  await page.waitForTimeout(200);
  let cs = await cats();
  assert.deepEqual(cs[0].models, ['claude-x', 'claude-y', 'gemini-z'], '加入「我的 Claude」');
  assert.deepEqual(cs[1].models, ['gemini-z'], '仍在「出图」里');
  // 编辑模型：去掉 gemini-z
  await page.locator('[data-catmenu]').first().click();
  await page.locator('#cw-root .cw-layer .cw-menu-item', { hasText: '编辑模型' }).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.cw-mpick-cnt').textContent(), '「我的 Claude」已选 3');
  await page.locator('.cw-mpick-list [data-sel="gemini-z"]').first().click();
  await page.locator('.cw-mpick-sel [data-act=save]').click();
  await page.waitForTimeout(100);
  assert.deepEqual((await cats())[0].models, ['claude-x', 'claude-y']);
  // 改名、删除
  await page.locator('[data-catmenu]').nth(1).click();
  await page.locator('#cw-root .cw-layer .cw-menu-item', { hasText: '改名' }).click();
  await page.locator('.cw-msec .cw-inline-input').fill('出图模型');
  await page.locator('.cw-msec .cw-inline-input').press('Enter');
  await page.waitForTimeout(100);
  assert.equal((await cats())[1].name, '出图模型');
  await page.locator('[data-catmenu]').nth(1).click();
  await page.locator('#cw-root .cw-layer .cw-menu-item', { hasText: '删除分类' }).click();
  await topSheet().locator('.cw-btn-danger').click();
  await page.waitForTimeout(100);
  assert.deepEqual((await cats()).map((c) => c.name), ['我的 Claude']);
  assert.deepEqual(await heads(), ['我的 Claude', 'Gemini'], '删掉的分类里的模型回到自动段');
  // 在分类里选模型
  if (!(await page.locator('.cw-mpick-list .cw-choice[data-m="claude-y"]').count())) await page.locator('.cw-mpick-list .cw-msec-h', { hasText: '我的 Claude' }).click();
  await page.locator('.cw-mpick-list .cw-choice[data-m="claude-y"]').click();
  await page.waitForFunction(() => window.__toasts.some((t) => /模型已切换为 claude-y/.test(t)));
  ok('自建分类：多选新建、加入、编辑、改名、删除；没分进去的按系列自动分段');

  // 2.5.0 测试：用选中的模型发一句「Hi」，回了就算能用；失败时第二行用最简单的话解释状态码
  let reply = { status: 200, json: { choices: [{ message: { content: 'Hello!  How can I help?' } }] } };
  const sent = [];
  await page.route('**/api/backends/chat-completions/generate', (r) => { sent.push(JSON.parse(r.request().postData())); r.fulfill({ status: reply.status, json: reply.json }); });
  await page.evaluate(() => {
    const c = window.SillyTavern.getContext();
    c.getChatCompletionModel = () => 'claude-y';
    c.ChatCompletionService = { presetToGeneratePayload: async (a, b, o) => ({ ...o }) };
  });
  const res = () => page.locator('.cw-live .cw-test').textContent();
  await page.click('.cw-live [data-act=testmodel]');
  await page.locator('.cw-live .cw-test.is-ok').waitFor({ timeout: 10000 });
  assert.equal(sent[0].model, 'claude-y', '用酒馆里选中的模型');
  assert.deepEqual(sent[0].messages, [{ role: 'user', content: 'Hi' }]);
  assert.equal(await res(), 'Successful');
  // 503：中转站把上游的报错塞在 message 里
  reply = { status: 503, json: { error: { message: JSON.stringify({ error: { message: 'Service Unavailable', type: 'upstream_error' } }) } } };
  await page.click('.cw-live [data-act=testmodel]');
  await page.locator('.cw-live .cw-test.is-bad').waitFor({ timeout: 10000 });
  assert.equal(await res(), '503 暂无可用渠道');
  assert.equal(await page.locator('.cw-live .cw-test').getAttribute('title'), 'Service Unavailable', '原文放在悬停提示里');
  // 酒馆回 500，报错文字里写着 504
  reply = { status: 500, json: { error: { message: 'Got response status 504 Gateway Timeout' } } };
  await page.click('.cw-live [data-act=testmodel]');
  await page.waitForFunction(() => document.querySelector('.cw-live .cw-test')?.textContent === '504 上游超时', null, { timeout: 10000 });
  // 酒馆回 200，报错里只有英文说法：认成 503，显示中文
  reply = { status: 200, json: { error: { message: 'Service Unavailable' } } };
  await page.click('.cw-live [data-act=testmodel]');
  await page.waitForFunction(() => document.querySelector('.cw-live .cw-test')?.textContent === '503 暂无可用渠道', null, { timeout: 10000 });
  // 认不出的：只写「未知错误」，点这一行看原文
  reply = { status: 200, json: { error: { message: 'something weird happened' } } };
  await page.click('.cw-live [data-act=testmodel]');
  await page.waitForFunction(() => document.querySelector('.cw-live .cw-test')?.textContent === '未知错误', null, { timeout: 10000 });
  await page.click('.cw-live .cw-test');
  await page.waitForFunction(() => window.__toasts.includes('info:原文：something weird happened'));
  // 报错里写着额度不足
  reply = { status: 429, json: { error: { message: 'insufficient_quota: You exceeded your current quota' } } };
  await page.click('.cw-live [data-act=testmodel]');
  await page.waitForFunction(() => document.querySelector('.cw-live .cw-test')?.textContent === '429 额度不足', null, { timeout: 10000 });
  assert.ok(!(await page.evaluate(() => window.__toasts.some((t) => /测试失败|可以用/.test(t)))), '不另弹提示');
  ok('点测试发送测试消息，结果写在模型下面一行');

  // 2.6.15 流式请求：收到第一段就算通，随即断开，不等模型想完、写完；第一段是报错时照样认出
  await page.unroute('**/api/backends/chat-completions/generate');
  const streamReply = (text, { close = true, status = 200 } = {}) => page.evaluate(([text, close, status]) => {
    window.__orig ||= window.fetch;
    window.__cancelled = false;
    window.fetch = (url, opt) => {
      if (!String(url).includes('chat-completions/generate')) return window.__orig(url, opt);
      window.__sentStream = JSON.parse(opt.body).stream;
      const body = new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode(text)); if (close) c.close(); },
        cancel() { window.__cancelled = true; }
      });
      return Promise.resolve(new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } }));
    };
  }, [text, close, status]);
  // 只给第一段、连接一直不关（模型还在写）：照样马上显示成功，并断开
  await streamReply(': keep-alive\n\nevent: message\ndata: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n', { close: false });
  await page.click('.cw-live [data-act=testmodel]');
  await page.waitForFunction(() => document.querySelector('.cw-live .cw-test')?.textContent === 'Successful' && window.__cancelled, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__sentStream), true, '按流式请求');
  // 第一段是报错事件
  await streamReply('data: {"error":{"message":"no available channel for model claude-y"}}\n\n');
  await page.click('.cw-live [data-act=testmodel]');
  await page.waitForFunction(() => document.querySelector('.cw-live .cw-test')?.textContent === '该分组无此模型', null, { timeout: 5000 });
  // Claude 的事件流报错
  await streamReply('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n');
  await page.click('.cw-live [data-act=testmodel]');
  await page.waitForFunction(() => document.querySelector('.cw-live .cw-test')?.textContent === '上游过载', null, { timeout: 5000 });
  // 流式请求被拒：酒馆把状态码和报错原样转回来
  await streamReply('{"error":{"message":"Invalid token"}}', { status: 400 });
  await page.click('.cw-live [data-act=testmodel]');
  await page.waitForFunction(() => document.querySelector('.cw-live .cw-test')?.textContent === '400 密钥无效', null, { timeout: 5000 });
  await page.evaluate(() => { window.fetch = window.__orig; });
  ok('流式请求：收到第一段就显示成功并断开；第一段是报错、请求被拒时显示原因');

  await page.click('[data-act=livemore]');
  assert.equal(await page.locator('.cw-dlg').count(), 0, '⋯ 在卡片里展开，不弹窗');
  const acts = await page.locator('.cw-live-detail .cw-card-acts button').allInnerTexts();
  assert.deepEqual(acts, ['编辑站点', '删除站点'], '⋯ 里不再放重新连接和获取模型列表');
  ok('⋯ 里只留编辑、删除');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
