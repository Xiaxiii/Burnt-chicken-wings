// 2.6.17 每张卡的状态栏：从世界书条目、显示正则里认出状态栏标签；认不准时不猜；状态栏出问题时的提醒只点名这个标签。
// 用法：node test/statusbar-core.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = ['../src/core/regex.js', '../src/core/replycheck.js', '../src/maintenance/statusbar.js']
  .map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
const f = new Function('ctx', 'settings', 'saveSettings', source + '\nreturn { statusCandidatesFrom, statusAutoPick, statusReminder, statusRules, statusEntryTags, checkReplyFormat, normalizeReplyRules, presetRegexAnchors };')(
  () => ({}), () => ({}), () => {}
);
let passed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}
const rules = f.normalizeReplyRules({ bodyTag: 'content' });
const display = (label, find, own = true) => ({ label, tags: f.presetRegexAnchors({ findRegex: find }).tags, find, own });
const world = (book, title, text, own = true) => ({ text, from: `世界书「${book}」条目「${title}」`, title, own });

test('the status block of a card is picked from its world book and display regex, not the reader-comment block', () => {
  const sources = [
    world('东宫', '状态栏', '每轮正文后输出：\n<lxs_status>\n<时>时辰</时>\n<地>地点</地>\n<言>起居注</言>\n</lxs_status>'),
    world('东宫', '读者段评', '正文后附读者段评：\n<段评>\n<评论>读者说的话</评论>\n</段评>'),
    { text: '正文写在 <content>…</content> 里。', from: '预设条目「输出格式」', title: '输出格式', own: false }
  ];
  const regex = [display('角色卡正则「起居注」', '<lxs_status>([\\s\\S]*?)<\\/lxs_status>'), display('角色卡正则「段评」', '<段评>([\\s\\S]*?)<\\/段评>')];
  const list = f.statusCandidatesFrom(sources, regex, rules);
  assert.deepEqual(list.map((c) => c.name), ['lxs_status', '段评'], '正文标签不算候选');
  const pick = f.statusAutoPick(list);
  assert.equal(pick.name, 'lxs_status');
  assert.deepEqual(pick.from, ['世界书「东宫」条目「状态栏」']);
  assert.deepEqual(pick.regex, ['角色卡正则「起居注」']);
});
test('another card whose status block is <状态栏> gets <状态栏>', () => {
  const sources = [world('江湖', '格式', '回复末尾输出状态栏：\n<状态栏>\n<地点>…</地点>\n<心情>…</心情>\n</状态栏>')];
  const pick = f.statusAutoPick(f.statusCandidatesFrom(sources, [display('角色卡正则「状态栏美化」', '<状态栏>([\\s\\S]*?)</状态栏>')], rules));
  assert.equal(pick.name, '状态栏');
});
test('the original case of a tag only a regex knows is kept', () => {
  const sources = [world('卡', '状态', '输出 <StatusBlock> 包住的状态信息。')];
  const list = f.statusCandidatesFrom(sources, [display('角色卡正则「状态」', '<StatusBlock>(.*?)</StatusBlock>')], rules);
  assert.equal(list[0].name, 'StatusBlock');
});
test('nothing is guessed when two blocks look alike or nothing looks like a status bar', () => {
  const two = [world('卡', '格式一', '<面板A>\n<x>1</x>\n</面板A>'), world('卡', '格式二', '<面板B>\n<y>1</y>\n</面板B>')];
  const r2 = [display('正则「A」', '<面板A>(.*?)</面板A>'), display('正则「B」', '<面板B>(.*?)</面板B>')];
  assert.equal(f.statusAutoPick(f.statusCandidatesFrom(two, r2, rules)), null, '两个都像，分不出');
  const plain = [world('卡', '小剧场', '<小剧场>\n<角色>甲</角色>\n</小剧场>')];
  const list = f.statusCandidatesFrom(plain, [display('正则「小剧场」', '<小剧场>(.*?)</小剧场>')], rules);
  assert.equal(list.length, 1, '列为候选，可手动选');
  assert.equal(f.statusAutoPick(list), null, '不像状态栏，不自动用');
  assert.deepEqual(f.statusCandidatesFrom([], [], rules), []);
});
test('entry tags list every paired tag of each world-book entry for manual choice', () => {
  const w = { texts: [
    { text: '<lxs_status>\n<时>x</时>\n</lxs_status>\n<div>不算</div>', from: '世界书「东宫」条目「状态栏」' },
    { text: '没有标签的条目 <', from: '世界书「东宫」条目「设定」' }
  ] };
  assert.deepEqual(f.statusEntryTags(w, rules), [{ from: '世界书「东宫」条目「状态栏」', tags: ['lxs_status', '时'] }]);
});
test('the status tag joins the required tags once, never as the body or a thinking tag', () => {
  assert.deepEqual(f.statusRules({ bodyTag: 'content', requiredTags: ['摘要'] }, { tag: 'lxs_status' }).requiredTags, ['摘要', 'lxs_status']);
  assert.deepEqual(f.statusRules({ bodyTag: 'content', requiredTags: ['LXS_STATUS'] }, { tag: 'lxs_status' }).requiredTags, ['LXS_STATUS']);
  assert.deepEqual(f.statusRules({ bodyTag: 'content', requiredTags: '摘要、状态' }, null).requiredTags, ['摘要', '状态']);
  assert.deepEqual(f.statusRules({ bodyTag: 'content', requiredTags: [] }, { tag: 'think' }).requiredTags, []);
  assert.deepEqual(f.statusRules({ bodyTag: 'content', requiredTags: [] }, { tag: 'content' }).requiredTags, []);
});
test('the status reminder names only the card status tag, never a wrong name', () => {
  const r = f.normalizeReplyRules({ requiredTags: ['lxs_status'] });
  const missing = f.checkReplyFormat('<content>正文</content>', r);
  assert.match(f.statusReminder(missing, 'lxs_status'), /^【状态栏提醒】上一轮回复没有 <lxs_status>…<\/lxs_status>。本轮正文结束后照常输出，标签名一字不改。/);
  const known = new Set(['content', 'lxs_status', '时']);
  known.children = new Map([['lxs_status', new Set(['时'])]]);
  const misnamed = f.checkReplyFormat('<content>正文</content>\n<状态栏>\n<时>巳时</时>\n</状态栏>', r, { knownTags: known });
  const text = f.statusReminder(misnamed, 'lxs_status');
  assert.match(text, /<lxs_status>/);
  assert.doesNotMatch(text, /状态栏>/, '不复述写错的 <状态栏>');
  const wrapped = f.checkReplyFormat('<content>正文</content>\n<状态栏>\n<lxs_status>\n<时>巳时</时>\n</lxs_status>\n</状态栏>', r, { knownTags: known });
  assert.match(f.statusReminder(wrapped, 'lxs_status'), /<lxs_status>…<\/lxs_status> 直接输出，外面不要再包其他标签/);
  const open = f.checkReplyFormat('<content>正文</content>\n<lxs_status>\n<时>巳时</时>', r);
  assert.match(f.statusReminder(open, 'lxs_status'), /不完整或重复/);
  const stuck = f.checkReplyFormat('<content>正文</content>', r, { reasoning: '想。\n<lxs_status>\n<时>巳时</时>\n</lxs_status>', layout: { head: [], tail: ['lxs_status'], names: {} } });
  assert.match(f.statusReminder(stuck, 'lxs_status'), /写进了思考区/);
  assert.equal(f.statusReminder(f.checkReplyFormat('<content>正文</content>\n<lxs_status>x</lxs_status>', r), 'lxs_status'), '', '没问题不提醒');
  assert.equal(f.statusReminder(f.checkReplyFormat('正文\n<lxs_status>x</lxs_status>', r), 'lxs_status'), '', '只缺正文标签时不归状态栏提醒');
});
console.log(`${passed} status-bar tests passed`);
