// 2.6.11 状态栏格式只写在世界书里的卡（<lxs_status>），模型在外面又包了一层 <状态栏>：
// 生成后只提示玩家、不提醒 AI；点提示打开检查；去掉这条和前面回复多包的一层（可撤销）；
// 写错名的判断用上世界书里的结构；与这张卡不符的必需标签不检查；关掉提示、只有疑似问题时不提示。
// 2.6.12 世界书不再每轮重读。
// 2.6.16 必需标签里填了这张卡不用的 <状态栏>、前面的回复里又有它时，写对的回复不再被报缺 <状态栏>；列出标签出处；
// 前面写错名的回复一并改回；自动修正去掉多包的一层。
// 先构建并在仓库根目录运行 8765 静态服务。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { replyPage, replySave, replyCancel } from './helpers.mjs';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const KEY = 'presetAtelier:reply-format';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
const STATUS = '<lxs_status>\n<时>亥时末</时>\n<地>东宫寝帐</地>\n</lxs_status>';
const wrapped = (n) => `<content>\n第 ${n} 轮正文。\n</content>\n<状态栏>\n${STATUS}\n</状态栏>`;
const clean = (n) => `<content>\n第 ${n} 轮正文。\n</content>\n${STATUS}`;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let host;
    Object.defineProperty(window, 'SillyTavern', {
      configurable: true,
      get: () => host,
      set(value) {
        host = value;
        const c = value.getContext();
        Object.assign(c.eventTypes, { GENERATION_AFTER_COMMANDS: 'generation_after_commands', MESSAGE_EDITED: 'message_edited', MESSAGE_UPDATED: 'message_updated' });
        window.__prompts = {};
        c.setExtensionPrompt = (key, text) => { window.__prompts[key] = text; };
        window.__chatSaves = 0;
        c.saveChat = async () => { window.__chatSaves++; };
        c.updateMessageBlock = () => {};
      }
    });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  await page.evaluate(async () => {
    window.__toasts = [];
    window.toastr = Object.fromEntries(['success', 'info', 'warning', 'error'].map((k) => [k, (m, _t, o) => window.__toasts.push({ type: k, m, o })]));
    // 状态栏格式写在全局启用的世界书里，预设和角色卡都没提 <lxs_status>
    globalThis.__wiStore['东宫状态栏'] = { entries: { 1: { uid: 1, comment: '状态栏', content: '每轮正文后输出状态栏：\n<lxs_status>\n<时>时辰</时>\n<地>地点</地>\n</lxs_status>', disable: false } } };
    (await import('/test/site/scripts/world-info.js')).selected_world_info.push('东宫状态栏');
    const c = window.SillyTavern.getContext();
    c.extensionSettings.presetAtelier.replyGuard = { [window.__mock.live.preset_settings_openai]: { bodyTag: 'content', requiredTags: ['lxs_status'] } };
  });
  const setChat = (latest, earlier = [wrapped(1), wrapped(2)]) => page.evaluate(([w1, w2, latest]) => {
    window.SillyTavern.getContext().chat = [
      { is_user: false, mes: '<content>\n开场。\n</content>\n<lxs_status>\n<时>戌时</时>\n<地>东宫</地>\n</lxs_status>' },
      { is_user: true, mes: '甲' }, { is_user: false, mes: w1, swipe_id: 0, swipes: [w1] },
      { is_user: true, mes: '乙' }, { is_user: false, mes: w2, swipe_id: 0, swipes: [w2] },
      { is_user: true, mes: '丙' }, { is_user: false, mes: latest, swipe_id: 0, swipes: [latest] }
    ];
  }, [...earlier, latest]);
  const mes = () => page.evaluate(() => window.SillyTavern.getContext().chat.filter((m) => !m.is_user).map((m) => m.mes));
  // 一轮生成：开始前 → 写入回复 → 结束
  const turn = async (latest) => {
    await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS, 'normal', {}, false); });
    await setChat(latest);
    await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_ENDED); });
    await page.waitForTimeout(800);
    return page.evaluate((key) => window.__prompts[key] || '', KEY);
  };
  const toasts = () => page.evaluate(() => window.__toasts.splice(0).map((t) => ({ type: t.type, m: t.m, escape: t.o?.escapeHtml, click: typeof t.o?.onclick })));

  // 1) 生成后：只提示玩家，不提醒 AI；同一条回复只提示一次
  assert.equal(await turn(wrapped(3)), '', '不自动提醒');
  const loadsAfterFirst = await page.evaluate(() => globalThis.__wiLoads || 0);
  assert.equal(loadsAfterFirst, 2, '第一次用到时读两本生效的世界书（示例世界书、东宫状态栏）各一次');
  let t = await toasts();
  assert.equal(t.length, 1);
  assert.equal(t[0].type, 'warning');
  assert.match(t[0].m, /^上一条回复：<lxs_status> 外面多包了一层 <状态栏>.*点此查看，可提醒下一轮$/);
  assert.deepEqual([t[0].escape, t[0].click], [true, 'function'], '提示里的标签按文字显示，点了能打开检查');
  await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_ENDED); });
  await page.waitForTimeout(600);
  assert.deepEqual(await toasts(), [], '同一条回复不重复提示');
  ok('生成后发现多包了一层：只弹提示给玩家，不提醒 AI，同一条只提示一次');

  // 2) 点提示：打开「回复」页并直接检查最近回复
  // 再生成一条新回复拿到可点的提示
  await turn(wrapped(4));
  // 2.6.12 世界书读过一次就记着（酒馆已缓存的直接读，不复制），不再每轮重读
  assert.equal(await page.evaluate(() => globalThis.__wiLoads || 0), loadsAfterFirst, '后面几轮不再读世界书');
  await page.evaluate(() => window.__toasts.splice(0).at(-1).o.onclick());
  const result = page.locator('#cw-root [data-r=result]');
  await result.locator('text=外面多包了一层').waitFor();
  assert.equal(await page.evaluate(() => !document.getElementById('cw-root').hidden), true, '面板已打开');
  const text = await result.innerText();
  assert.match(text, /<lxs_status> 外面多包了一层 <状态栏>，预设、角色卡和世界书都没有用到这个标签/);
  assert.match(text, /去掉 <lxs_status> 外面多包的 <状态栏>…<\/状态栏>/);
  assert.match(await page.locator('#cw-root [data-r=remind-card] pre').textContent(), /<lxs_status>…<\/lxs_status> 直接输出，外面不要再包其他标签/);
  assert.doesNotMatch(await page.locator('#cw-root [data-r=remind-card] pre').textContent(), /状态栏/, '提醒不出现 <状态栏>');
  assert.match(await page.locator('#cw-root [data-r=earlier-card]').innerText(), /前面还有 2 条回复有同样的问题（<lxs_status> 外面多包的 <状态栏>）。模型会照着前面的回复写/);
  assert.equal(await page.locator('#cw-root [data-r=origins] li').innerText(), '<状态栏>：聊天里前面 2 条 AI 回复', '标签出处：预设、世界书里没有，聊天里有');
  ok('点提示打开检查：列出问题、修正步骤、标签出处和不含 <状态栏> 的提醒，并指出前面 2 条回复也多包了一层');

  // 3) 前面的回复一并去掉（只保存一次），可撤销；再修正这一条
  const saves = await page.evaluate(() => window.__chatSaves);
  await page.click('#cw-root [data-act=rp-fix-earlier]');
  await page.locator('#cw-root [data-act=rp-undo-earlier]').waitFor();
  assert.deepEqual((await mes()).slice(1, 3), [clean(1), clean(2)]);
  assert.equal(await page.evaluate(() => window.__chatSaves) - saves, 1, '一并去掉只保存一次');
  assert.equal(await page.evaluate(() => window.SillyTavern.getContext().chat[2].swipes[0]), clean(1), '当前这一版的滑动记录同步');
  await page.click('#cw-root [data-act=rp-undo-earlier]');
  await page.locator('#cw-root .cw-page[data-page=reply]', { hasText: '已撤销 2 条回复的修改' }).waitFor();
  assert.deepEqual((await mes()).slice(1, 3), [wrapped(1), wrapped(2)]);
  await page.click('#cw-root [data-act=rp-fix-earlier]');
  await page.locator('#cw-root [data-act=rp-undo-earlier]').waitFor();
  await page.click('#cw-root [data-act=rp-fix]');
  await page.locator('#cw-root [data-act=rp-undo-fix]').waitFor();
  assert.deepEqual((await mes()).slice(1), [clean(1), clean(2), clean(4)]);
  assert.match(await result.innerText(), /未发现配置范围内的格式问题/);
  assert.equal(await page.locator('#cw-root [data-r=earlier-card]').count(), 0);
  ok('去掉前面回复多包的一层，可撤销；修正这一条后不再有问题');

  // 4) 写错名：世界书里写了 <lxs_status> 的子标签，结构对得上，判为写错名；提醒不复述 <状态栏>
  await setChat('<content>\n第 5 轮正文。\n</content>\n<状态栏>\n<时>子时</时>\n<地>东宫</地>\n</状态栏>');
  await page.click('#cw-root [data-act=rp-latest]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  await result.locator('text=多半是写错了名字').waitFor();
  assert.match(await result.innerText(), /<状态栏> 预设没有用到，多半是写错了名字的 <lxs_status>/);
  const remind = await page.locator('#cw-root [data-r=remind-card] pre').textContent();
  assert.match(remind, /上一轮的 <lxs_status> 标签名写错了/);
  assert.doesNotMatch(remind, /状态栏/);
  ok('写错名的判断读世界书里的结构；提醒不复述写错的名字');

  // 5) 必需标签填成这张卡不用的 <状态栏>：不检查、不提醒
  await setChat(clean(5), [clean(1), clean(2)]);
  await page.fill('#cw-root [data-f=required]', '状态栏');
  await page.click('#cw-root [data-act=rp-latest]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  await result.locator('text=这张卡没有用到').waitFor();
  assert.match(await result.innerText(), /这张卡没有用到 <状态栏>：预设条目、角色卡、世界书和开场白里都没有，未检查/);
  assert.equal(await page.locator('#cw-root [data-r=origins]').count(), 0, '哪里都没有的不列出处');
  assert.match(await result.innerText(), /未发现配置范围内的格式问题/);
  assert.equal(await page.locator('#cw-root [data-act=rp-remind]').count(), 0);
  await replyCancel(page);
  ok('与这张卡不符的必需标签不检查、不提醒');

  // 6) 关掉提示时不提示；只有「疑似推理标题」这类要人工判断的问题时不提示
  await page.evaluate(() => {
    const s = window.SillyTavern.getContext().extensionSettings.presetAtelier;
    s.replyGuard[window.__mock.live.preset_settings_openai].notice = false;
  });
  assert.equal(await turn(wrapped(6)), '');
  assert.deepEqual(await toasts(), [], '关掉提示后不提示');
  await page.evaluate(() => {
    const s = window.SillyTavern.getContext().extensionSettings.presetAtelier;
    delete s.replyGuard[window.__mock.live.preset_settings_openai].notice;
  });
  await turn(`${clean(7)}\n## 思考过程`);
  assert.deepEqual(await toasts(), [], '只有疑似问题时不提示');
  ok('关掉提示、只有疑似问题时不提示');

  // 7) 2.6.16 必需标签里同时填了这张卡不用的 <状态栏>，前面的回复里又有它
  const misnamed = (n) => `<content>\n第 ${n} 轮正文。\n</content>\n<状态栏>\n<时>亥时末</时>\n<地>东宫寝帐</地>\n</状态栏>`;
  await page.evaluate(() => {
    const s = window.SillyTavern.getContext().extensionSettings.presetAtelier;
    s.replyGuard[window.__mock.live.preset_settings_openai] = { bodyTag: 'content', requiredTags: ['状态栏', 'lxs_status'] };
  });
  await turn(clean(8));
  assert.deepEqual(await toasts(), [], '写对的回复不再报缺 <状态栏>');
  await turn(wrapped(9));
  t = await toasts();
  assert.match(t[0]?.m || '', /^上一条回复：<lxs_status> 外面多包了一层 <状态栏>/, '<状态栏> 填在必需标签里也照样认出多包的一层');
  ok('必需标签里有这张卡不用的 <状态栏>：写对的回复不提示，多包的一层照样提示');

  // 前面写成 <状态栏> 的回复：子标签对得上，一并改回 <lxs_status>
  await setChat(clean(10), [misnamed(1), wrapped(2)]);
  await page.evaluate(() => window.__presetAtelier.open('reply'));
  await replyPage(page);
  await page.click('#cw-root [data-act=rp-latest]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.match(await result.innerText(), /未发现配置范围内的格式问题/);
  assert.match(await result.innerText(), /这张卡没有用到 <状态栏>：预设条目、角色卡、世界书和开场白里都没有，未检查/);
  assert.equal(await page.locator('#cw-root [data-r=origins] li').innerText(), '<状态栏>：聊天里前面 2 条 AI 回复');
  assert.match(await page.locator('#cw-root [data-r=earlier-card]').innerText(), /前面还有 2 条回复有同样的问题（写成 <状态栏> 的 <lxs_status>、<lxs_status> 外面多包的 <状态栏>）/);
  await page.click('#cw-root [data-act=rp-fix-earlier]');
  await page.locator('#cw-root [data-act=rp-undo-earlier]').waitFor();
  assert.deepEqual((await mes()).slice(1), [clean(1), clean(2), clean(10)]);
  await replyCancel(page);
  ok('前面写成 <状态栏> 的回复改回 <lxs_status>，多包的一层去掉');

  // 自动修正：多包的一层、写错的名字生成完就改回
  await page.evaluate(() => {
    const s = window.SillyTavern.getContext().extensionSettings.presetAtelier;
    s.replyGuard[window.__mock.live.preset_settings_openai].autoFix = true;
  });
  await turn(wrapped(11));
  assert.equal((await mes()).at(-1), clean(11));
  t = await toasts();
  assert.deepEqual([t.at(-1)?.type, t.at(-1)?.m], ['success', '已自动修正这条回复：去掉 <lxs_status> 外面多包的 <状态栏>…</状态栏>。可在「回复」页撤销']);
  await turn(misnamed(12));
  assert.equal((await mes()).at(-1), clean(12));
  assert.match((await toasts()).at(-1)?.m || '', /^已自动修正这条回复：把 <状态栏>…<\/状态栏> 改名为 <lxs_status>…<\/lxs_status>/);
  ok('开了自动修正：多包的一层、写错的 <状态栏> 生成完就改回');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
