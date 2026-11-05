// 2.6.17 每张卡的状态栏：从角色绑定的世界书和角色卡正则里自动认出（东宫 <lxs_status>、江湖 <状态栏>），各卡分开；
// 掉了时下一轮提醒一次、只点名这张卡的标签；认不准时可选候选、选世界书条目或手动填写；可设为不检查；可关掉自动提醒。
// 先构建并在仓库根目录运行 8765 静态服务。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { replyPage, replySave, replyCancel } from './helpers.mjs';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const KEY = 'presetAtelier:reply-format';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
const LXS = '<lxs_status>\n<时>巳时</时>\n<地>望仙台</地>\n</lxs_status>';
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
        c.saveChat = async () => {};
        c.updateMessageBlock = () => {};
      }
    });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__toasts = [];
    window.toastr = Object.fromEntries(['success', 'info', 'warning', 'error'].map((k) => [k, (m, _t, o) => window.__toasts.push({ type: k, m, o })]));
    const regex = (name, tag) => ({ id: name, scriptName: name, findRegex: `/<${tag}>([\\s\\S]*?)<\\/${tag}>/g`, replaceString: '<div>$1</div>', placement: [2], disabled: false, markdownOnly: true, promptOnly: false });
    Object.assign(globalThis.__wiStore, {
      东宫书: { entries: {
        1: { uid: 1, comment: '状态栏', content: '每轮正文后输出：\n<lxs_status>\n<时>时辰</时>\n<地>地点</地>\n</lxs_status>', disable: false },
        2: { uid: 2, comment: '读者段评', content: '正文后附读者段评：\n<段评>\n<评论>读者的话</评论>\n</段评>', disable: false }
      } },
      江湖书: { entries: { 1: { uid: 1, comment: '格式', content: '回复末尾输出状态栏：\n<状态栏>\n<地点>…</地点>\n<心情>…</心情>\n</状态栏>', disable: false } } },
      杂卡书: { entries: {
        1: { uid: 1, comment: '格式一', content: '<面板A>\n<x>1</x>\n</面板A>', disable: false },
        2: { uid: 2, comment: '格式二', content: '<面板B>\n<y>1</y>\n</面板B>', disable: false }
      } }
    });
    const c = window.SillyTavern.getContext();
    c.characters = [
      { name: '东宫', avatar: 'donggong.png', data: { extensions: { world: '东宫书', regex_scripts: [regex('起居注', 'lxs_status'), regex('段评', '段评')] } } },
      { name: '江湖', avatar: 'jianghu.png', data: { extensions: { world: '江湖书', regex_scripts: [regex('状态栏美化', '状态栏')] } } },
      { name: '杂卡', avatar: 'zaka.png', data: { extensions: { world: '杂卡书', regex_scripts: [regex('A', '面板A'), regex('B', '面板B')] } } }
    ];
    c.characterId = 0;
    // 预设里只填了泛称「状态栏」：各卡照样按自己的标签查
    c.extensionSettings.presetAtelier.replyGuard = { [window.__mock.live.preset_settings_openai]: { bodyTag: 'content', requiredTags: ['状态栏'] } };
  });
  const card = (i, chatId) => page.evaluate(async ([i, chatId]) => {
    const c = window.SillyTavern.getContext();
    c.characterId = i;
    c.chatId = chatId;
    await c.eventSource.emit(c.eventTypes.CHAT_CHANGED);
  }, [i, chatId]);
  const setChat = (latest) => page.evaluate((latest) => {
    window.SillyTavern.getContext().chat = [{ is_user: false, mes: '<content>开场。</content>' }, { is_user: true, mes: '甲' }, { is_user: false, mes: latest, swipe_id: 0, swipes: [latest] }];
  }, latest);
  const before = () => page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS, 'normal', {}, false); });
  const turn = async (latest) => {
    await before();
    await setChat(latest);
    await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.GENERATION_ENDED); });
    await page.waitForTimeout(800);
  };
  const prompt = () => page.evaluate((key) => window.__prompts[key] || '', KEY);
  const toasts = () => page.evaluate(() => window.__toasts.splice(0).map((t) => t.m));
  const openDialog = async () => {
    await page.evaluate(() => window.__presetAtelier.open('reply'));
    await replyPage(page);
    await page.waitForFunction(() => { const b = document.querySelector('#cw-root [data-r=status-body]'); return b && !b.textContent.includes('正在读取'); });
    return (await page.locator('#cw-root [data-r=status-body]').innerText()).replace(/\s+/g, ' ').trim();
  };
  const closeDialog = async () => {
    await replyCancel(page);
  };
  const pick = (text) => page.locator('#cw-root .cw-layer .cw-menu-item', { hasText: text }).first().click();

  // 1) 东宫：自动认出 <lxs_status>（不是读者段评）；掉了时提示，下一轮提醒一次，只点名 <lxs_status>
  assert.equal(await openDialog(), '<lxs_status> 世界书「东宫书」条目「状态栏」 · 自动识别 更改');
  assert.match(await page.locator('#cw-root [data-r=status-title]').innerText(), /「东宫」的状态栏/);
  await closeDialog();
  await turn('<content>\n正文。\n</content>');
  assert.deepEqual(await toasts(), ['上一条回复：缺少完整的 <lxs_status>…</lxs_status> 标签。下一轮将提醒用 <lxs_status>。点此查看']);
  await before();
  const sent = await prompt();
  assert.match(sent, /^【状态栏提醒】上一轮回复没有 <lxs_status>…<\/lxs_status>。本轮正文结束后照常输出，标签名一字不改。/);
  assert.doesNotMatch(sent, /状态栏>|段评/, '不点名预设里的泛称，也不点名读者段评');
  await before();
  assert.equal(await prompt(), '', '只提醒一轮');
  await turn(`<content>\n正文。\n</content>\n${LXS}`);
  assert.deepEqual(await toasts(), [], '写对了不提示');
  await before();
  assert.equal(await prompt(), '', '写对了不提醒');
  ok('东宫：自动认出 <lxs_status>；掉了时提示并提醒一轮，只点名 <lxs_status>；写对了不提示');

  // 2) 江湖：自动认出 <状态栏>；与东宫各管各的
  await card(1, 'c2');
  assert.equal(await openDialog(), '<状态栏> 世界书「江湖书」条目「格式」 · 自动识别 更改');
  await closeDialog();
  await turn('<content>\n正文。\n</content>');
  await before();
  assert.match(await prompt(), /上一轮回复没有 <状态栏>…<\/状态栏>/);
  await toasts();
  await card(0, 'c1');
  await turn(`<content>\n正文。\n</content>\n${LXS}`);
  assert.deepEqual(await toasts(), [], '回到东宫，照旧按 <lxs_status> 查');
  ok('江湖：自动认出 <状态栏>；两张卡各按自己的标签查');

  // 3) 杂卡：两个块都像，认不准，不查不提醒；从候选里选定后照选定的查
  await card(2, 'c3');
  assert.equal(await openDialog(), '找到 2 个可能的块，认不准哪个是状态栏，请选择。 选择');
  await closeDialog();
  await turn('<content>\n正文。\n</content>');
  await before();
  assert.equal(await prompt(), '', '认不准时不提醒');
  await toasts();
  await openDialog();
  await page.click('#cw-root [data-act=rp-status-pick]');
  await pick('<面板B>');
  await page.waitForFunction(() => document.querySelector('#cw-root [data-r=status-body]')?.textContent.includes('已选定'));
  assert.equal((await page.locator('#cw-root [data-r=status-body]').innerText()).replace(/\s+/g, ' ').trim(), '<面板B> 世界书「杂卡书」条目「格式二」 · 已选定 更改');
  await closeDialog();
  await turn('<content>\n正文。\n</content>');
  await before();
  assert.match(await prompt(), /上一轮回复没有 <面板B>…<\/面板B>/);
  ok('杂卡：认不准时不查；从候选里选定后照选定的查');

  // 4) 从世界书条目里选、手动填写、不检查、改回自动识别
  await openDialog();
  await page.click('#cw-root [data-act=rp-status-pick]');
  await pick('从世界书条目里选');
  await pick('世界书「杂卡书」条目「格式一」');
  await pick('<面板A>');
  await page.waitForFunction(() => document.querySelector('#cw-root [data-r=status-body]')?.textContent.includes('面板A'));
  await page.click('#cw-root [data-act=rp-status-pick]');
  await pick('手动填写标签名');
  await page.locator('#cw-root .cw-layer .cw-dlg input.cw-input').last().fill('<StatusBlock>');
  await page.locator('#cw-root .cw-layer .cw-dlg .cw-btn-primary').last().click();
  await page.waitForFunction(() => document.querySelector('#cw-root [data-r=status-body]')?.textContent.includes('StatusBlock'));
  assert.equal((await page.locator('#cw-root [data-r=status-body]').innerText()).replace(/\s+/g, ' ').trim(), '<StatusBlock> 手动填写 · 已选定 更改');
  await page.click('#cw-root [data-act=rp-status-pick]');
  await pick('这张卡没有状态栏');
  await page.waitForFunction(() => document.querySelector('#cw-root [data-r=status-body]')?.textContent.includes('不检查状态栏'));
  await closeDialog();
  await turn('<content>\n正文。\n</content>');
  await before();
  assert.equal(await prompt(), '', '不检查状态栏的卡不提醒');
  await toasts();
  await openDialog();
  await page.click('#cw-root [data-act=rp-status-pick]');
  await pick('改回自动识别');
  await page.waitForFunction(() => document.querySelector('#cw-root [data-r=status-body]')?.textContent.includes('认不准'));
  await closeDialog();
  const saved = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.statusBars);
  assert.deepEqual(Object.keys(saved), [], '改回自动识别后不留记录');
  ok('可从世界书条目里选、手动填写（清理尖括号）、设为不检查、改回自动识别');

  // 5) 关掉自动提醒：照常提示，不提醒 AI
  await card(0, 'c1');
  await openDialog();
  await page.locator('#cw-root [data-act=rp-statusremind]').uncheck({ force: true });
  await closeDialog();
  await toasts();
  await turn('<content>\n正文。\n</content>');
  assert.deepEqual(await toasts(), ['上一条回复：缺少完整的 <lxs_status>…</lxs_status> 标签。点此查看，可提醒下一轮']);
  await before();
  assert.equal(await prompt(), '');
  ok('关掉自动提醒后只提示，不提醒 AI');

  // 6) 检查窗口：这张卡的状态栏一起查
  await openDialog();
  await page.click('#cw-root [data-act=rp-latest]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.match(await page.locator('#cw-root [data-r=result]').innerText(), /缺少完整的 <lxs_status>…<\/lxs_status> 标签/);
  assert.match(await page.locator('#cw-root [data-r=remind-card] pre').textContent(), /<lxs_status>…<\/lxs_status>/);
  await closeDialog();
  ok('检查窗口把这张卡的状态栏一起查，「下一轮提醒一次」点名 <lxs_status>');

  // 7) 2.6.18 状态栏写坏：另写了一份 <状态栏>、写成 <状态栏>，生成完自动改回（默认开）；正文不动
  const DUP = `<content>\n正文。\n</content>\n${LXS}\n\n<状态栏>\n<时>巳时</时>\n<地>望仙台</地>\n</状态栏>`;
  const GOOD = `<content>\n正文。\n</content>\n${LXS}`;
  const last = () => page.evaluate(() => window.SillyTavern.getContext().chat.at(-1).mes);
  await turn(DUP);
  assert.equal(await last(), GOOD);
  assert.ok((await toasts()).includes('已自动修正这条回复：删去另写的一份状态栏（<状态栏>…</状态栏>）。可在「回复」页撤销'));
  await turn('<content>\n正文。\n</content>\n<状态栏>\n<时>巳时</时>\n<地>望仙台</地>\n</状态栏>');
  assert.equal(await last(), GOOD);
  assert.ok((await toasts()).some((m) => /^已自动修正这条回复：把 <状态栏>…<\/状态栏> 改名为 <lxs_status>…<\/lxs_status>/.test(m)));
  ok('另写的一份 <状态栏> 生成完自动删去，写成 <状态栏> 的自动改名');

  // 关掉自动改回：只提示；检查窗口列出问题和 <状态栏> 的出处，「修正这条回复」删去那一份，前面的回复一并修正
  await openDialog();
  await page.locator('#cw-root [data-act=rp-statusfix]').uncheck({ force: true });
  await closeDialog();
  await toasts();
  await page.evaluate((dup) => {
    window.SillyTavern.getContext().chat = [{ is_user: false, mes: '<content>开场。</content>' }, { is_user: true, mes: '甲' }, { is_user: false, mes: dup }, { is_user: true, mes: '乙' }, { is_user: false, mes: dup, swipe_id: 0, swipes: [dup] }];
  }, DUP);
  await openDialog();
  await page.click('#cw-root [data-act=rp-latest]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  const res = page.locator('#cw-root [data-r=result]');
  assert.match(await res.innerText(), /状态栏写了两份：<lxs_status> 之外还有一份 <状态栏>/);
  assert.match(await page.locator('#cw-root [data-r=origins]').innerText(), /<状态栏>：聊天里前面 1 条 AI 回复/);
  assert.match(await page.locator('#cw-root [data-r=remind-card] pre').textContent(), /状态栏只输出一份 <lxs_status>…<\/lxs_status>，不要另写一份/);
  assert.match(await page.locator('#cw-root [data-r=earlier-card]').innerText(), /前面还有 1 条回复有同样的问题（状态栏写了两份/);
  await page.click('#cw-root [data-act=rp-fix]');
  await page.locator('#cw-root [data-act=rp-undo-fix]').waitFor();
  await page.click('#cw-root [data-act=rp-fix-earlier]');
  await page.locator('#cw-root [data-act=rp-undo-earlier]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.SillyTavern.getContext().chat.filter((m) => !m.is_user).map((m) => m.mes)), ['<content>开场。</content>', GOOD, GOOD]);
  await page.locator('#cw-root [data-act=rp-statusfix]').check({ force: true });
  await closeDialog();
  ok('关掉自动改回时只提示；检查窗口列出 <状态栏> 出处，可修正这条和前面的回复');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
