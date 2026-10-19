const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeReplyRules, checkReplyFormat, buildReplyReminder, replyCheckMask } = new Function(
  fs.readFileSync(path.join(__dirname, '../src/core/replycheck.js'), 'utf8') +
  '\nreturn { normalizeReplyRules, checkReplyFormat, buildReplyReminder, replyCheckMask };'
)();
let passed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}
const kinds = (text, rules) => checkReplyFormat(text, rules).issues.map((issue) => issue.kind);
const clean = (text, rules) => assert.deepEqual(checkReplyFormat(text, rules).issues, []);
test('defaults and normalized rules round trip', () => {
  assert.deepEqual(normalizeReplyRules(), { bodyTag: 'content', thinkingTags: ['think', 'thinking'], requiredTags: [] });
  const rules = normalizeReplyRules({ bodyTag: '正文', thinkingTag: '内部分析', requiredTags: '摘要， 状态\n时间、摘要' });
  assert.deepEqual(rules.requiredTags, ['摘要', '状态', '时间']);
  assert.deepEqual(normalizeReplyRules(rules), rules);
});
test('normal body and optional serial thought blocks', () => {
  clean('<content>故事正文。</content>');
  clean('<think>内部文字。</think>\n<thinking>更多文字。</thinking>\n<content>故事正文。</content>');
  clean('<CONTENT>故事正文。</CONTENT>');
});
test('Chinese and custom tags with required tags', () => {
  clean('<内部分析>隐藏区</内部分析><正文>故事。<状态>晴</状态></正文><摘要>结束。</摘要>', { bodyTag: '正文', thinkingTag: '内部分析', requiredTags: ['状态', '摘要'] });
});
test('missing body, opening and closing', () => {
  assert(kinds('只有正文。').includes('missing'));
  assert(kinds('正文。</content>').includes('missing'));
  assert(kinds('<content>正文。').includes('missing'));
});
test('missing required tag', () => assert(kinds('<content>正文。</content>', { requiredTags: '摘要' }).includes('missing')));
test('duplicate body and required tags', () => {
  assert(kinds('<content>一</content><content>二</content>').includes('duplicate'));
  assert(kinds('<content>正文。</content><摘要>一</摘要><摘要>二</摘要>', { requiredTags: ['摘要'] }).includes('duplicate'));
});
test('empty body including markup and comments', () => {
  assert(kinds('<content> \n </content>').includes('empty'));
  assert(kinds('<content><p></p><!-- 示例 --></content>').includes('empty'));
});
test('closing before opening is invalid', () => assert(kinds('</content><content>正文。').includes('order')));
test('crossed body and required tags are invalid', () => assert(kinds('<content><摘要>文字</content></摘要>', { requiredTags: ['摘要'] }).includes('order')));
test('self-closing tags cannot replace complete pairs', () => {
  assert(kinds('<content/>').includes('order'));
  assert(kinds('<think/><content>正文</content>').includes('order'));
});
test('unclosed and unmatched thought tags', () => {
  assert(kinds('<think>思考<content>故事</content>').includes('order'));
  assert(kinds('</thinking><content>故事</content>').includes('order'));
});
test('nested thought tags are invalid even if balanced', () => assert(kinds('<think><thinking>内容</thinking></think><content>正文</content>').includes('order')));
test('body swallowed in thought', () => assert(kinds('<think><content>正文</content></think>').includes('swallowed')));
test('required tag swallowed in custom thought', () => assert(kinds('<分析区><摘要>摘要</摘要></分析区><content>正文</content>', { thinkingTag: '分析区', requiredTags: ['摘要'] }).includes('swallowed')));
test('thought leaks into body', () => assert(kinds('<content>正文<think>内部分析</think></content>').includes('leak')));
test('crossed thought and body detects structural problem', () => {
  const found = kinds('<think><content>正文</think></content>');
  assert(found.includes('swallowed'));
  assert(found.includes('order'));
});
test('fenced tag examples outside body are ignored', () => {
  clean('```xml\n<think><content>示例</content></think>\n```\n<content>正文</content>');
  clean('~~~~xml\n<content>示例</content>\n~~~\n</think>\n~~~~\n<content>正文</content>');
});
test('code-only body counts as content without inspecting example tags', () => clean('<content>\n```xml\n<think>示例</think>\n```\n</content>'));
test('inline code examples do not become real thought tags or comments', () => {
  clean('<content>纸条写着 `<think>`。</content>');
  clean('<content>示例是 `` `<think>` ``。</content>');
  clean('<content>注释示例 `<!-- 未闭合`。</content>');
  clean('`<content>示例</content>`\n<content>正常正文。</content>');
  assert(kinds('<content>未成对的反引号 `<think>内部分析</think></content>').includes('leak'));
});
test('HTML comment examples and headings are ignored', () => clean('<!--\n<content>示例</content>\n### 分析\n-->\n<content>正文</content>'));
test('unclosed HTML comment inside a code fence does not swallow outside body', () => {
  clean('```html\n<!--\n```\n<content>正常正文。</content>');
  clean('~~~html\n<!-- 注释示例\n~~~\n<content>正常正文。</content>');
});
test('code-only body preserves an unclosed HTML comment example', () => {
  const source = '<content>\n```html\n<!-- 示例未闭合\n```\n</content>';
  clean(source);
  assert(replyCheckMask(source, true).includes('<!-- 示例未闭合'));
});
test('code fences inside an HTML comment do not swallow outside body', () => {
  clean('<!--\n```html\n<content>注释中的示例</content>\n-->\n<content>正常正文。</content>');
  clean('<!--\n~~~html\n### 分析\n-->\n<content>正常正文。</content>');
});
test('real unclosed HTML comments remain masked until end', () => {
  assert(kinds('<!--\n```html\n<content>注释中的正文</content>').includes('missing'));
  clean('<content>正常正文。</content>\n<!--\n```html\n### 分析\n<content>注释中的正文</content>');
});
test('mask preserves length and all newline positions through mixed regions', () => {
  const source = '<!--\r\n```\r\n-->\r\n```html\r\n<!-- 未闭合\r\n```\r\n<content>正常<!-- 隐藏 -->正文。</content>';
  for (const preserveCode of [false, true]) {
    const masked = replyCheckMask(source, preserveCode);
    assert.equal(masked.length, source.length);
    assert.deepEqual([...masked.matchAll(/[\r\n]/g)].map((match) => match.index), [...source.matchAll(/[\r\n]/g)].map((match) => match.index));
  }
  clean(source);
});
test('unclosed fence ignores tag examples until end', () => clean('<content>正文</content>\n```xml\n<think><content>示例</content>'));
test('obvious reasoning headers outside body are only suspected', () => {
  for (const header of ['### 思考', '分析：先做这一步', '### 推理过程', 'Step 1: 检查要求', '### Phase 1']) {
    assert(kinds(`${header}\n<content>正文</content>`).includes('suspected'), header);
  }
});
test('narration and headings inside body or thought are not suspected', () => {
  clean('思考这件事让他停下脚步。\n<content>正文</content>');
  clean('<content>\n### 分析\n角色分析了案情。\n</content>');
  clean('<think>\n### 分析\n内容。\n</think><content>正文</content>');
  clean('<content>第一步，他走出房门。</content>');
});
test('empty optional thought tag is omitted', () => assert.deepEqual(normalizeReplyRules({ thinkingTag: '' }).thinkingTags, ['think', 'thinking']));
test('illegal explicit rules throw', () => {
  for (const rule of [{ bodyTag: '' }, { bodyTag: '<content>' }, { bodyTag: '1body' }, { bodyTag: 'x'.repeat(41) }, { bodyTag: 'think' }, { bodyTag: '正文', thinkingTag: '正文' }, { requiredTags: ['thinking'] }, { requiredTags: ['a/b'] }, { requiredTags: [null] }, { requiredTags: 3 }, { thinkingTags: 'think' }]) {
    assert.throws(() => normalizeReplyRules(rule), JSON.stringify(rule));
  }
});
test('required tags deduplicate case insensitively', () => {
  assert.deepEqual(normalizeReplyRules({ requiredTags: ['summary', 'SUMMARY', '状态'] }).requiredTags, ['summary', '状态']);
  clean('<content>正文</content>', { requiredTags: ['content'] });
});
test('reminder is empty for a valid report', () => assert.equal(buildReplyReminder(checkReplyFormat('<content>正文</content>')), ''));
test('reminder uses configured complete tags and never asks to reveal thoughts', () => {
  const rules = normalizeReplyRules({ bodyTag: '正文', requiredTags: ['摘要'] });
  const reminder = buildReplyReminder(checkReplyFormat('丢标签了', rules), rules);
  assert(reminder.includes('<正文>…</正文>'));
  assert(reminder.includes('<摘要>…</摘要>'));
  assert(reminder.includes('思考标签之外'));
  assert(reminder.includes('不要复述上一轮'));
  assert(reminder.includes('无需展示思考过程'));
});
console.log(`${passed} reply-format tests passed`);
