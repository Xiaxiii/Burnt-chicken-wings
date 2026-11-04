// 临时格式提醒的生成前检查与生命周期，不修改聊天和预设。
// 用法：node test/reply-runtime.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = ['../src/core/replycheck.js', '../src/maintenance/statusbar.js', '../src/maintenance/replyguard.js']
  .map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
const KEY = 'presetAtelier:reply-format';
const EVENTS = Object.fromEntries(['GENERATION_AFTER_COMMANDS', 'CHAT_CHANGED', 'PRESET_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED'].map((key) => [key, key.toLowerCase()]));
let passed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}
function fixture() {
  const calls = [], prompts = {}, cleanups = [], warnings = [];
  const state = { replyGuard: {} };
  let selected = 'A', chatId = 'chat-1';
  const context = {
    chat: [{ is_user: false, mes: '开场白无标签' }, { is_user: true, mes: '继续' }, { is_user: false, mes: '正文掉标签了', extra: { reasoning: '<think>原生推理字段</think>' } }],
    mainApi: 'openai', eventTypes: { ...EVENTS },
    getCurrentChatId: () => chatId,
    setExtensionPrompt(...args) { calls.push(args); prompts[args[0]] = args[1]; }
  };
  const functions = new Function('ctx', 'settings', 'currentPresetName', 'cleanups', 'console', source + '\nreturn { replyGuardConfig, replyGuardAvailable, latestReplyForCheck, clearReplyGuard, prepareReplyGuard, bindReplyGuard, armReplyReminder, replyReminderArmed, replyApplicable, replyCardRules, armStatusReminder };')(
    () => context, () => state, () => selected, cleanups, { warn: (...args) => warnings.push(args) }
  );
  const hooks = new Map();
  functions.bindReplyGuard((event, fn) => {
    if (event) hooks.set(event, [...(hooks.get(event) || []), fn]);
  }, context.eventTypes);
  return {
    ...functions, context, state, calls, prompts, cleanups, warnings,
    select(name) { selected = name; },
    switchChat(id) { chatId = id; },
    emit(event, ...args) { for (const fn of hooks.get(event) || []) fn(...args); },
    generate(type = 'normal', dryRun = false) { this.emit(EVENTS.GENERATION_AFTER_COMMANDS, type, {}, dryRun); },
    prompt() { return prompts[KEY] || ''; }
  };
}
// 2.6.16 必需标签这张卡用不用，只看预设、角色卡、世界书和开场白有没有要求，不看模型写的回复
test('a required tag counts for the card only when the preset, card, world books or greeting ask for it', () => {
  const f = fixture();
  const known = new Set(['content', 'lxs_status', '状态栏']);
  known.asked = new Set(['content', 'lxs_status']);
  const chat = [{ is_user: false, mes: '<content>开场</content><摘要>序</摘要>' }, { is_user: true, mes: '继续' },
    { is_user: false, mes: '<content>正文</content><状态栏><lxs_status>x</lxs_status></状态栏>' }];
  const applicable = f.replyApplicable(() => known, chat);
  assert.equal(applicable('lxs_status'), true);
  assert.equal(applicable('摘要'), true, '开场白是卡写的，照算');
  assert.equal(applicable('状态栏'), false, '只在正则或模型的回复里出现，不算这张卡要的');
  assert.equal(f.replyApplicable(() => null, chat)('状态栏'), true, '读不到预设时一律算');
  const rules = { bodyTag: 'content', thinkingTags: ['think', 'thinking'], requiredTags: ['状态栏', 'lxs_status'] };
  assert.deepEqual(f.replyCardRules(rules, applicable).requiredTags, ['lxs_status']);
});
const TEXT = '【回复格式提醒】请让 <content>…</content> 完整成对出现一次。';
// 2.6.17 状态栏掉了时排好的提醒：下一次正常生成加入一次，和玩家点的提醒一起；续写不用掉，换聊天作废
test('the status-bar reminder is injected once with the player reminder, kept over continue, dropped on chat change', () => {
  const f = fixture();
  const STATUS = '【状态栏提醒】上一轮回复没有 <lxs_status>…</lxs_status>。';
  f.armStatusReminder(STATUS);
  f.generate('continue');
  assert.equal(f.prompt(), '', '续写不用掉');
  f.armReplyReminder(TEXT);
  f.generate();
  assert.equal(f.prompt(), `${TEXT}\n${STATUS}`);
  f.generate();
  assert.equal(f.prompt(), '', '只提醒一轮');
  f.armStatusReminder(STATUS);
  f.emit(EVENTS.CHAT_CHANGED);
  f.generate();
  assert.equal(f.prompt(), '', '换聊天作废');
  f.armStatusReminder(STATUS);
  f.switchChat('chat-2');
  f.generate();
  assert.equal(f.prompt(), '', '排好提醒的聊天已不是当前聊天');
});
// 2.6.11 不再自动提醒：玩家点「下一轮提醒一次」后，下一次生成加入一次
test('nothing is injected by default, even for a bad reply with the old automatic setting saved', () => {
  const f = fixture();
  f.generate();
  assert.equal(f.prompt(), '');
  f.state.replyGuard.A = { enabled: true, bodyTag: 'content', requiredTags: ['状态栏'] };
  f.generate();
  assert.equal(f.prompt(), '', '旧版存的「下一轮提醒 AI」不再生效');
  assert.equal(f.calls.filter((c) => c[1]).length, 0);
});
test('an armed reminder is injected once at depth zero, then cleared', () => {
  const f = fixture();
  const chat = structuredClone(f.context.chat), settings = structuredClone(f.state);
  f.armReplyReminder(TEXT);
  assert.equal(f.replyReminderArmed(), TEXT);
  f.generate();
  assert.equal(f.prompt(), TEXT);
  assert.deepEqual(f.calls.at(-1), [KEY, TEXT, 1, 0, false, 0]);
  assert.equal(f.replyReminderArmed(), null, '用掉了');
  f.emit(EVENTS.GENERATION_ENDED);
  f.generate();
  assert.equal(f.prompt(), '', '只提醒一轮');
  assert.deepEqual(f.context.chat, chat);
  assert.deepEqual(f.state, settings);
});
test('dry runs and quiet, impersonate, first_message and continue do not use the reminder up', () => {
  const f = fixture();
  f.armReplyReminder(TEXT);
  for (const type of ['quiet', 'impersonate', 'first_message', 'continue']) {
    f.generate(type); assert.equal(f.prompt(), '', type);
  }
  f.generate('normal', true); assert.equal(f.prompt(), '');
  assert.equal(f.replyReminderArmed(), TEXT);
  f.generate('swipe'); assert.equal(f.prompt(), TEXT, '重新生成、滑动时用上');
});
test('switching chats drops the reminder', () => {
  const f = fixture();
  f.armReplyReminder(TEXT);
  f.switchChat('chat-2');
  assert.equal(f.replyReminderArmed(), null);
  f.generate(); assert.equal(f.prompt(), '');
  f.switchChat('chat-1');
  f.generate(); assert.equal(f.prompt(), '', '换回来也不再提醒');
  f.armReplyReminder(TEXT);
  f.emit(EVENTS.CHAT_CHANGED);
  f.generate(); assert.equal(f.prompt(), '');
  f.armReplyReminder(TEXT); f.armReplyReminder(null);
  f.generate(); assert.equal(f.prompt(), '', '取消后不提醒');
});
test('chat, preset and generation lifecycle events clear the injected prompt', () => {
  const f = fixture();
  for (const event of [EVENTS.CHAT_CHANGED, EVENTS.PRESET_CHANGED, EVENTS.GENERATION_STARTED, EVENTS.GENERATION_ENDED, EVENTS.GENERATION_STOPPED]) {
    f.armReplyReminder(TEXT); f.generate(); assert.equal(f.prompt(), TEXT); f.emit(event); assert.equal(f.prompt(), '', event);
  }
  f.armReplyReminder(TEXT); f.generate(); f.cleanups.forEach((cleanup) => cleanup()); assert.equal(f.prompt(), '');
});
test('checks only AI messages after a user turn and ignores greetings and system messages', () => {
  const f = fixture();
  for (const chat of [[], [{ is_user: false, mes: '开场白' }], [{ is_user: true, mes: '用户输入' }], [{ is_user: true, mes: '你好' }, { is_user: false, is_system: true, mes: '系统消息' }]]) {
    assert.equal(f.latestReplyForCheck(chat), null);
  }
  f.context.chat = [{ is_user: false, mes: '开场白' }, { is_user: true, mes: '你好' }, { is_user: false, mes: '<content>正常正文</content>' }, { is_system: true, mes: '系统无标签' }, { is_user: true, mes: '用户无标签' }];
  assert.equal(f.latestReplyForCheck(f.context.chat).index, 2);
});
test('non-openai API and missing host APIs keep the reminder for later without touching chats', () => {
  const f = fixture();
  const chat = structuredClone(f.context.chat);
  f.armReplyReminder(TEXT);
  f.context.mainApi = 'textgenerationwebui'; f.generate(); assert.equal(f.prompt(), '');
  f.context.mainApi = 'openai';
  delete f.context.eventTypes.GENERATION_AFTER_COMMANDS;
  assert.equal(f.replyGuardAvailable(), false); f.prepareReplyGuard('normal', {}, false); assert.equal(f.prompt(), '');
  f.context.eventTypes.GENERATION_AFTER_COMMANDS = EVENTS.GENERATION_AFTER_COMMANDS;
  assert.equal(f.replyReminderArmed(), TEXT);
  delete f.context.setExtensionPrompt;
  assert.equal(f.replyGuardAvailable(), false); assert.doesNotThrow(() => f.generate());
  assert.deepEqual(f.context.chat, chat);
});
console.log(`${passed} reply-format runtime tests passed`);
