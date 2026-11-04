// 正文格式检查的 UI 与宿主提示接口回归。先构建并在仓库根目录运行 8765 静态服务。
// 用法：PW_CHROME=/usr/bin/chromium node test/reply-guard-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { replyPage, replySave, replyCancel } from './helpers.mjs';
import { choose } from './helpers.mjs';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const KEY = 'presetAtelier:reply-format';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
async function openPage({ interfaces = true, mobile = false } = {}) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 900 }, isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', (error) => errors.push(error.message));
  if (interfaces) await page.addInitScript(() => {
    let host;
    Object.defineProperty(window, 'SillyTavern', {
      configurable: true,
      get: () => host,
      set(value) {
        host = value;
        const context = value.getContext();
        context.eventTypes.GENERATION_AFTER_COMMANDS = 'generation_after_commands';
        window.__replyCalls = [];
        window.__replyPrompts = {};
        context.setExtensionPrompt = (...args) => {
          window.__replyCalls.push(args);
          window.__replyPrompts[args[0]] = args[1];
        };
      }
    });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });
  await page.evaluate(() => window.__presetAtelier.open('reply'));
  await replyPage(page);
  return page;
}
const dialog = (page) => replyPage(page);
const close = (page, save = false) => save ? replySave(page) : replyCancel(page);
const settings = (page) => page.evaluate(() => window.SillyTavern.getContext().extensionSettings.presetAtelier.replyGuard);
const reminder = (page) => page.evaluate((key) => window.__replyPrompts[key] || '', KEY);
const generate = (page, type = 'normal', dryRun = false) => page.evaluate(async ({ type, dryRun }) => {
  const c = window.SillyTavern.getContext();
  await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS, type, {}, dryRun);
}, { type, dryRun });
// 2.6.11 开场白里有的标签才算这张卡用得上（预设、角色卡、世界书都没写 <摘要>、<状态>）
const GREETING = '<正文>开场白</正文><摘要>序</摘要><状态>晴</状态>';
const reply = (page, text, greeting = GREETING) => page.evaluate(([text, greeting]) => {
  window.SillyTavern.getContext().chat = [{ is_user: false, mes: greeting }, { is_user: true, mes: '继续故事' }, { is_user: false, mes: text, extra: { reasoning: '模型单独返回的推理字段' } }];
}, [text, greeting]);
// 打开格式窗口，检查最近回复，点「下一轮提醒一次」
const arm = async (page) => {
  await dialog(page);
  await page.click('[data-act=rp-latest]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  await page.click('[data-act=rp-remind]');
  await page.locator('[data-act=rp-unremind]').waitFor();
  const text = await page.locator('[data-r=remind-card] pre').textContent();
  await close(page);
  return text;
};
try {
  const page = await openPage();
  const active = await page.evaluate(() => window.__mock.live.preset_settings_openai);
  const original = await page.evaluate(() => ({ chat: JSON.stringify(window.SillyTavern.getContext().chat), presets: JSON.stringify(window.__mock.presets), saves: window.__saved || 0 }));
  await generate(page);
  assert.equal(await reminder(page), '');
  assert.deepEqual(await settings(page), {});
  await dialog(page);
  assert.equal(await page.locator('[data-r=enabled]').count(), 0, '没有「下一轮提醒 AI」勾选框');
  assert.equal(await page.locator('[data-act=rp-notice]').isChecked(), true, '生成后提示默认开');
  await page.click('[data-act=rp-latest]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.match(await page.locator('[data-r=result]').innerText(), /缺少完整的 <content>/);
  await page.fill('[data-r=sample]', '<content>正文<think>内部分析</think></content>');
  await page.click('[data-act=rp-paste]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.match(await page.locator('[data-r=result]').innerText(), /正文内部出现/);
  await page.fill('[data-r=sample]', '<think><content>正文</content></think>');
  await page.click('[data-act=rp-paste]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.match(await page.locator('[data-r=result]').innerText(), /吞入思考区/);
  await close(page);
  assert.deepEqual(await settings(page), {});
  assert.equal(await page.evaluate(() => JSON.stringify(window.SillyTavern.getContext().chat)), original.chat);
  ok('默认不提醒，手检发现掉标签、思考夹入正文和正文被吞；取消不保存、不修改聊天');

  await dialog(page);
  await page.fill('[data-f=body]', '正文');
  await page.fill('[data-f=required]', '摘要，状态、摘要');
  await page.fill('[data-f=thinking]', '分析区');
  await page.fill('[data-r=sample]', '<分析区>内部文字</分析区><正文>故事正文</正文><摘要>概述</摘要><状态>晴</状态>');
  await page.click('[data-act=rp-paste]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.match(await page.locator('[data-r=result]').innerText(), /未发现配置范围内的格式问题/);
  await page.fill('[data-f=body]', '<1非法>');
  await replySave(page);
  assert.equal(await page.locator('#cw-root [data-f=body]').count(), 1);
  assert.match(await page.locator('#cw-root [data-err=body]').innerText(), /标签名/, '报错写在正文标签框下面');
  assert.deepEqual(await settings(page), {});
  await page.fill('[data-f=body]', '正文');
  await page.fill('[data-r=sample]', '仅供手检的未保存样本');
  await close(page, true);
  assert.deepEqual((await settings(page))[active], { bodyTag: '正文', requiredTags: ['摘要', '状态'], thinkingTag: '分析区' });
  assert.equal(JSON.stringify(await settings(page)).includes('仅供手检'), false);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__mock.presets)), original.presets);
  assert.equal(await page.evaluate(() => window.__saved || 0), original.saves);
  ok('支持自定义正文、必需和思考标签；非法标签阻止保存，样本不持久化，预设不改动');

  // 2.6.11 不自动提醒；点了「下一轮提醒一次」才在下一次生成加入一次
  await reply(page, '本轮丢标签');
  await generate(page);
  assert.equal(await reminder(page), '', '有问题也不自动提醒');
  let armed = await arm(page);
  assert.match(armed, /<正文>…<\/正文>、<摘要>…<\/摘要>、<状态>…<\/状态> 各完整成对出现一次/);
  for (const type of ['quiet', 'impersonate', 'first_message', 'continue']) {
    await generate(page, type); assert.equal(await reminder(page), '', type);
  }
  await generate(page, 'normal', true); assert.equal(await reminder(page), '', '试算不用掉');
  await generate(page);
  assert.equal(await reminder(page), armed);
  assert.deepEqual(await page.evaluate(() => window.__replyCalls.at(-1).slice(2)), [1, 0, false, 0]);
  await generate(page); assert.equal(await reminder(page), '', '只提醒一轮');
  // 只点名出问题的标签
  await reply(page, '<正文>正常正文</正文><状态>晴</状态>');
  armed = await arm(page);
  assert.match(armed, /请让 <摘要>…<\/摘要> 完整成对出现一次/);
  assert.doesNotMatch(armed, /<正文>|<状态>/);
  for (const event of ['CHAT_CHANGED', 'PRESET_CHANGED', 'GENERATION_ENDED', 'GENERATION_STOPPED']) {
    if (event !== 'CHAT_CHANGED') await arm(page);
    else await generate(page);
    if (event !== 'CHAT_CHANGED') await generate(page);
    assert.ok(await reminder(page), event);
    await page.evaluate(async (event) => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes[event]); }, event);
    assert.equal(await reminder(page), '', event);
  }
  // 换聊天作废；取消后不提醒
  await arm(page);
  await page.evaluate(async () => { const c = window.SillyTavern.getContext(); await c.eventSource.emit(c.eventTypes.CHAT_CHANGED); });
  await generate(page); assert.equal(await reminder(page), '', '换聊天后作废');
  await dialog(page);
  await page.click('[data-act=rp-latest]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  await page.click('[data-act=rp-remind]');
  await page.click('[data-act=rp-unremind]');
  await page.locator('[data-act=rp-remind]').waitFor();
  await close(page);
  await generate(page); assert.equal(await reminder(page), '', '取消后不提醒');
  ok('不自动提醒；点「下一轮提醒一次」后下一次生成加入一次，只点名出问题的标签；续写等不用掉，换聊天、取消后作废');

  const second = '正文检查测试预设';
  await page.evaluate((name) => {
    window.__mock.names.push(name);
    window.__mock.presets.push(structuredClone(window.__mock.presets[0]));
    window.__presetAtelier.open('reply');
  }, second);
  await page.locator('#cw-root .cw-scope:visible').first().click();
  await choose(page, second);
  await dialog(page);
  assert.equal(await page.locator('[data-f=body]').inputValue(), 'content');
  await reply(page, '坏回复');
  await page.click('[data-act=rp-latest]');
  await page.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.equal(await page.locator('[data-act=rp-remind]').count(), 0, '看的不是正在用的预设：不给提醒按钮');
  assert.match(await page.locator('[data-r=result]').innerText(), /切到这个预设后才能提醒/);
  await close(page, true);
  assert.equal((await settings(page))[second].enabled, undefined);
  assert.equal((await settings(page))[active].bodyTag, '正文');
  ok('规则按预设保存；提醒只给酒馆正在用的预设');

  const fallback = await openPage({ interfaces: false });
  await dialog(fallback);
  assert.match(await fallback.locator('#cw-root .cw-page[data-page=reply]').innerText(), /可以检查和修正，不能提醒下一轮/);
  await fallback.click('[data-act=rp-latest]');
  await fallback.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.match(await fallback.locator('[data-r=result]').innerText(), /发现 \d+ 个格式风险/);
  assert.equal(await fallback.locator('[data-act=rp-remind]').count(), 0, '不能提醒时不给按钮');
  await fallback.evaluate(() => { window.SillyTavern.getContext().chat = [{ is_user: false, mes: '开场白' }, { is_system: true, mes: '系统' }, { is_user: true, mes: '用户' }]; });
  await fallback.click('[data-act=rp-latest]');
  await fallback.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.match(await fallback.locator('[data-r=result]').innerText(), /没有可检查的 AI 回复/);
  await fallback.fill('[data-r=sample]', '<content>手检正常</content>');
  await fallback.click('[data-act=rp-paste]');
  await fallback.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.match(await fallback.locator('[data-r=result]').innerText(), /未发现配置范围内的格式问题/);
  await close(fallback, true);
  assert.equal(Object.values(await settings(fallback))[0].enabled, undefined);
  ok('缺少宿主接口时不能提醒，最近回复与粘贴手检仍可用');

  const mobile = await openPage({ mobile: true });
  await dialog(mobile);
  const layout = await mobile.locator('#cw-root .cw-page[data-page=reply]').evaluate((sheet) => {
    const rect = sheet.getBoundingClientRect();
    return { width: innerWidth, left: rect.left, right: rect.right, overflow: sheet.scrollWidth > sheet.clientWidth + 2, fields: [...sheet.querySelectorAll('input:not([type=checkbox]),textarea')].map((field) => { const r = field.getBoundingClientRect(); return { left: r.left, right: r.right }; }) };
  });
  assert.ok(layout.left >= -1 && layout.right <= layout.width + 1);
  assert.equal(layout.overflow, false);
  assert.ok(layout.fields.every((field) => field.left >= -1 && field.right <= layout.width + 1));
  assert.equal(await mobile.locator('[data-act=rp-latest]').isVisible(), true, '移动端可使用最近回复检测');
  assert.equal(await mobile.locator('[data-act=rp-paste]').isVisible(), true, '移动端可使用粘贴检测');
  await mobile.fill('[data-r=sample]', '<content>移动端正文</content>');
  await mobile.click('[data-act=rp-paste]');
  await mobile.waitForSelector('[data-r=result]:not([aria-busy])');
  assert.match(await mobile.locator('[data-r=result]').innerText(), /未发现配置范围内的格式问题/);
  await close(mobile, true);
  ok('390px 移动端弹窗、字段与操作无横向溢出');
  assert.deepEqual(errors, []);
  console.log('正文格式检查浏览器回归全部通过');
} finally {
  await browser.close();
}
