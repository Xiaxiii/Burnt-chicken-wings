const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeReplyRules, checkReplyFormat, buildReplyReminder, replyCheckMask, planReplyFix } = new Function(
  fs.readFileSync(path.join(__dirname, '../src/core/replycheck.js'), 'utf8') +
  '\nreturn { normalizeReplyRules, checkReplyFormat, buildReplyReminder, replyCheckMask, planReplyFix };'
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

test('analysis written before the body tag is reported with an excerpt', () => {
  const report = checkReplyFormat('我需要先检查用户要求，再安排剧情，然后写出符合人设的对话内容。\n<content>故事正文。</content>');
  const issue = report.issues.find((i) => i.kind === 'outside');
  assert(issue && issue.text.startsWith('正文标签前'));
  assert(issue.excerpt.startsWith('我需要先检查用户要求'));
  assert.match(buildReplyReminder(report), /正文标签外不要写任何分析/);
});
test('loose text after the body is reported, tag blocks, code and short endings are not', () => {
  assert(kinds('<content>正文。</content>\n以上是本轮正文。接下来我会继续推进剧情，并在下一轮安排角色登场。').includes('outside'));
  clean('<content>正文。</content>\n<状态栏>积分：3，等级：D，位格：凡人，道具：无</状态栏>');
  clean('<content>正文。</content>\n```\n状态栏代码块里的说明文字很长很长很长很长很长很长\n```');
  clean('<content>正文。</content>\n<!-- 这里是很长很长很长很长很长很长很长很长的注释 -->');
  clean('<content>正文。</content>\n（本轮完）');
  clean('<think>分析写在思考标签里，不论多长都不算正文外的文字。</think>\n<content>正文。</content>');
});
test('body swallowed into the reasoning field is detected only when the visible reply lacks the body tag', () => {
  assert(kinds('', undefined).includes('missing'));
  const report = checkReplyFormat('', undefined, { reasoning: '我先想一想。\n<content>故事正文</content>' });
  assert(report.issues.some((i) => i.kind === 'reasoning'));
  assert.match(buildReplyReminder(report), /思考标签必须在 <content> 开始之前闭合/);
  assert(!checkReplyFormat('<content>正文</content>', undefined, { reasoning: '计划：写 <content> 标签' }).issues.length);
  assert(checkReplyFormat('', undefined, { reasoning: '很长的推理'.repeat(50) }).issues.some((i) => i.kind === 'reasoning'));
  assert(!checkReplyFormat('掉标签的正文', undefined, { reasoning: '短推理' }).issues.some((i) => i.kind === 'reasoning'));
});
const letters = (s) => [...s.replace(/<[^<>]*>|【\/?[^】]*】|\[\/?[^\]]*\]/g, '').replace(/\s/g, '')].sort().join('');
const fixed = (text, rules, extra) => {
  const plan = planReplyFix(text, rules, extra);
  assert(plan, text);
  assert.equal(letters(plan.text + (plan.reasoning || '')), letters(text + (extra?.reasoning || '')), '修正不增删文字');
  return plan;
};
test('fix renames misnamed or bracketed body tags', () => {
  assert.equal(fixed('<正文>故事。</正文>').text, '<content>故事。</content>');
  assert.equal(fixed('【content】故事。【/content】').text, '<content>故事。</content>');
  assert.equal(fixed('[Story]故事。[/Story]').text, '<content>故事。</content>');
  assert.equal(fixed('<content>故事。</content>'.replace(/content/g, '正文'), { bodyTag: 'story' }).text, '<story>故事。</story>');
});
test('fix closes an unclosed thought before the body and moves a swallowed body out', () => {
  const a = fixed('<think>分析\n<content>故事。</content>');
  assert.equal(a.text, '<think>分析\n</think>\n<content>故事。</content>');
  assert.deepEqual(a.after.issues, []);
  const b = fixed('<think>分析A<content>故事。</content>分析B</think>');
  assert.equal(b.text, '<think>分析A\n分析B\n</think>\n<content>故事。</content>');
  assert.deepEqual(b.after.issues, []);
});
test('fix adds a missing closing or opening body tag', () => {
  const a = fixed('<content>故事很长。\n\n<状态栏>积分：3</状态栏>\n');
  assert.equal(a.text, '<content>故事很长。\n</content>\n<状态栏>积分：3</状态栏>\n');
  assert.equal(fixed('<content>故事').text, '<content>故事\n</content>');
  assert.equal(fixed('<think>想</think>\n故事。</content>').text, '<think>想</think>\n<content>\n故事。</content>');
  assert.equal(fixed('<content>故事', { requiredTags: ['摘要'] }).text, '<content>故事\n</content>');
  assert.equal(fixed('<content>故事\n<摘要>概要</摘要>', { requiredTags: ['摘要'] }).text, '<content>故事\n</content>\n<摘要>概要</摘要>');
});
test('fix moves the body back from the reasoning field', () => {
  const plan = fixed('', undefined, { reasoning: '我在想。\n<content>故事正文</content>' });
  assert.equal(plan.text, '<content>故事正文</content>');
  assert.equal(plan.reasoning, '我在想。');
  assert(plan.reasoningChanged);
  const open = fixed('<状态栏>x</状态栏>', undefined, { reasoning: '我在想。\n<content>故事正文' });
  assert.equal(open.text, '<content>故事正文\n</content>\n<状态栏>x</状态栏>');
});
test('fix declines when only text or duplicates are wrong', () => {
  assert.equal(planReplyFix('<content>好</content>'), null);
  assert.equal(planReplyFix('只有正文没有标签'), null);
  assert.equal(planReplyFix('<content>一</content><content>二</content>'), null);
});
test('leaked leading thought moves into the reasoning area (2.4.1)', () => {
  const same = planReplyFix('我先分析一下用户的要求和人设，然后安排剧情发展。<content>正文</content>');
  assert.equal(same.text, '<content>正文</content>');
  assert.equal(same.reasoning, '我先分析一下用户的要求和人设，然后安排剧情发展。');
  assert(same.reasoningChanged);
  // 开头的注释、后面的锚定注释和标题都留在原处，只移走没被包住的那一段
  const text = '<!-- Start -->\n[按步骤详细思考下面所有要求，不要跳过任何一步]\n第一步：确认身份和任务。\n第二步：梳理前文和人物。\n<!-- 锚定: 视角 -->\n<novel_header>\n[CHAP] 07\n</novel_header>\n<content>\n正文\n</content>';
  const plan = planReplyFix(text, undefined, { reasoning: '模型自带的思考' });
  assert.equal(plan.text, '<!-- Start -->\n<!-- 锚定: 视角 -->\n<novel_header>\n[CHAP] 07\n</novel_header>\n<content>\n正文\n</content>');
  assert.equal(plan.reasoning, '模型自带的思考\n\n[按步骤详细思考下面所有要求，不要跳过任何一步]\n第一步：确认身份和任务。\n第二步：梳理前文和人物。');
  assert.deepEqual(plan.after.issues, []);
  // 开头是没闭合的思考标签：仍按原来的方式在正文前补结束标签，不整段搬走
  const open = planReplyFix('<thinking>\n第一步：确认身份和任务，梳理前文。\n<content>正文</content>');
  assert.equal(open.text, '<thinking>\n第一步：确认身份和任务，梳理前文。\n</thinking>\n<content>正文</content>');
  assert.equal(open.reasoningChanged, false);
  // 字数太少不算
  assert.equal(planReplyFix('好的。<content>正文</content>'), null);
});
test('auto fix does not close a possibly truncated body at the end', () => {
  assert.equal(planReplyFix('<content>故事写到一半', undefined, { noTailClose: true }), null);
  assert.equal(planReplyFix('<content>故事写到一半').text, '<content>故事写到一半\n</content>');
  // 后面还有别的标签时，补在那个标签前面仍然安全
  assert.equal(planReplyFix('<content>故事\n<状态栏>晴</状态栏>', { requiredTags: ['状态栏'] }, { noTailClose: true }).text, '<content>故事\n</content>\n<状态栏>晴</状态栏>');
});
console.log(`${passed} reply-format tests passed`);
