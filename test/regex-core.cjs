// 直接加载真实模型和正则搬运逻辑：node test/regex-core.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sourceCode = ['core/model.js', 'core/regex.js'].map(file => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8')).join('\n');
const A = new Function(sourceCode + '\nreturn { Draft, presetRegexList, presetRegexSnapshot, planPresetRegexTransfer, validatePresetRegexTransfer, applyPresetRegexTransfer };')();
const clone = value => JSON.parse(JSON.stringify(value));
const rule = (id, scriptName, extra = {}) => ({
  id, scriptName, findRegex: '/<status>([\\s\\S]*?)<\\/status>/g',
  replaceString: '<section class="status">$1</section>', trimStrings: ['  '],
  placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
  runOnEdit: true, substituteRegex: 1, minDepth: 0, maxDepth: 8, ...extra
});
const draft = (name, rules, extra = {}) => new A.Draft(name, {
  temperature: 0.8,
  prompts: [{ identifier: 'a', name: '现有条目', content: '保留正文', role: 'system' }],
  prompt_order: [
    { character_id: 100001, order: [{ identifier: 'a', enabled: false }] },
    { character_id: 42, order: [{ identifier: 'a', enabled: true }] }
  ],
  ...extra,
  extensions: { independent: { enabled: true, value: ['保留'] }, ...(extra.extensions || {}), ...(rules === undefined ? {} : { regex_scripts: rules }) }
});
const pair = (from, to = []) => [draft('来源', from), draft('目标', to)];
const plan = (from, to, selectedIndices, conflictChoices) => A.planPresetRegexTransfer(from, to, { selectedIndices, conflictChoices });
const unchangedOnError = (target, fn, expression) => {
  const before = JSON.stringify(target);
  assert.throws(fn, expression);
  assert.equal(JSON.stringify(target), before, '失败时目标、历史和待保存状态均不得变化');
};
let passed = 0;
const test = (name, run) => { run(); passed++; console.log('✓', name); };

test('正则缝合按来源原序追加，重复选择只搬一次，来源和目标在预览时均不变', () => {
  const [from, to] = pair([rule('a', '甲'), rule('b', '乙'), rule('c', '丙')], [rule('old', '原有')]);
  const before = [JSON.stringify(from), JSON.stringify(to)];
  const p = plan(from, to, [2, 0, 2]);
  assert.deepEqual(p.rules.map(r => r.scriptName), ['原有', '甲', '丙']);
  assert.deepEqual(p.stats, { added: 2, replaced: 0, skipped: 0 });
  assert.equal(JSON.stringify(from), before[0]); assert.equal(JSON.stringify(to), before[1]);
  assert.equal(A.applyPresetRegexTransfer(to, p, from), true);
  assert.equal(JSON.stringify(from), before[0], '实际搬运也不修改来源');
});

test('正则缝合原样保留原生开关、所有作用位置、未知字段和 HTML，不运行或重写表达式', () => {
  const opaque = rule('opaque', '未来格式', {
    findRegex: '/[invalid(/z', replaceString: '<script>globalThis.regexCoreExecuted = true</script> $1 {{getvar::x}}',
    disabled: true, markdownOnly: true, promptOnly: true, placement: [0, 1, 2, 3, 5, 6, 999],
    futureField: { z: [true, null, { value: '未知设置' }], a: '保留' }, minDepth: null, maxDepth: null
  });
  const [from, to] = pair([opaque]);
  const p = plan(from, to, [0]);
  A.applyPresetRegexTransfer(to, p, from);
  assert.deepEqual(to.preset.extensions.regex_scripts[0], opaque);
  assert.equal(globalThis.regexCoreExecuted, undefined);
  assert.notEqual(to.preset.extensions.regex_scripts[0], from.preset.extensions.regex_scripts[0]);
  to.preset.extensions.regex_scripts[0].futureField.z[2].value = '只改目标';
  assert.equal(from.preset.extensions.regex_scripts[0].futureField.z[2].value, '未知设置');
});

test('正则缝合跳过只有 id 和属性排列不同的精确重复，不生成重复历史或扩展字段', () => {
  const existing = rule('old', '相同规则', { future: { first: 1, second: 2 } });
  const incoming = { future: { second: 2, first: 1 }, ...rule('new', '相同规则') };
  const [from, to] = pair([incoming], [existing]);
  const before = JSON.stringify(to);
  const p = plan(from, to, [0]);
  assert.deepEqual(p.stats, { added: 0, replaced: 0, skipped: 1 });
  assert.equal(p.rows[0].duplicate, true);
  assert.equal(A.applyPresetRegexTransfer(to, p, from), false);
  assert.equal(JSON.stringify(to), before);
  const empty = draft('空目标', undefined), emptyBefore = JSON.stringify(empty);
  const emptyPlan = plan(from, empty, []);
  assert.equal(A.applyPresetRegexTransfer(empty, emptyPlan, from), false);
  assert.equal(JSON.stringify(empty), emptyBefore);
  assert.equal(Object.hasOwn(empty.preset.extensions, 'regex_scripts'), false);
});

test('正则缝合不会把名称、disabled、未知字段或 placement 顺序不同的规则当成重复', () => {
  const original = rule('old', '原名');
  for (const change of [
    { scriptName: '另一个名称' }, { disabled: true }, { future: true }, { placement: [6, 2] },
    { markdownOnly: false }, { promptOnly: true }, { replaceString: '$2' }
  ]) {
    const [from, to] = pair([rule('new', '原名', change)], [original]);
    const p = plan(from, to, [0]);
    assert.equal(p.stats.added, 1, JSON.stringify(change));
    assert.equal(p.rows[0].duplicate, false);
  }
  const [from, to] = pair([rule('new', '原名', { placement: [6, 2] })], [rule('old', '原名', { placement: [2, 6] })]);
  assert.equal(plan(from, to, [0]).stats.added, 1);
});

test('正则缝合同名保留两份沿用来源独立编号，同编号保留两份生成稳定的新编号', () => {
  const [from, to] = pair([rule('source', '同名', { replaceString: '新的美化' })], [rule('target', '同名')]);
  const p = plan(from, to, [0]);
  assert.equal(p.rules[1].id, 'source');
  assert.equal(p.rows[0].conflicts[0].index, 0);
  const [from2, to2] = pair([rule('same', '新规则')], [rule('same', '旧规则')]);
  const p2 = plan(from2, to2, [0], { 0: 'keep' });
  assert.notEqual(p2.rules[1].id, 'same');
  assert.equal(typeof p2.rules[1].id, 'string'); assert.ok(p2.rules[1].id);
  const previewId = p2.rules[1].id;
  A.applyPresetRegexTransfer(to2, p2, from2);
  assert.equal(to2.preset.extensions.regex_scripts[1].id, previewId, '确认时不重新生成编号');
  assert.equal(from2.preset.extensions.regex_scripts[0].id, 'same');
});

test('正则缝合缺失和空编号自动补齐，同一批次的编号冲突不会传入目标', () => {
  const [from, to] = pair([
    rule(undefined, '缺少编号'), rule('', '空编号'), rule('batch', '同编号甲'), rule('batch', '同编号乙')
  ], [rule('existing', '原有')]);
  const p = plan(from, to, [0, 1, 2, 3]);
  const ids = p.rules.map(r => r.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0));
  assert.equal(p.rules[3].id, 'batch'); assert.notEqual(p.rules[4].id, 'batch');
});

test('正则缝合同名或同编号的跳过均不改目标，也不丢掉未选择的来源规则', () => {
  const [from, to] = pair([rule('new', '同名'), rule('old', '编号相同')], [rule('old', '同名')]);
  const p = plan(from, to, [0, 1], { 0: 'skip', 1: 'skip' });
  assert.deepEqual(p.stats, { added: 0, replaced: 0, skipped: 2 });
  assert.deepEqual(p.rules, to.preset.extensions.regex_scripts);
  assert.equal(A.applyPresetRegexTransfer(to, p, from), false);
  const p2 = plan(from, to, [1]);
  assert.equal(p2.rows[0].action, 'unselected');
  assert.equal(p2.rules.length, 2);
});

test('正则缝合单个冲突显式替换保留目标编号和位置，其余目标原样保留', () => {
  for (const collision of ['name', 'id']) {
    const existing = [rule('before', '前'), rule('stable', '目标'), rule('after', '后')];
    const incoming = rule(collision === 'id' ? 'stable' : 'incoming', collision === 'name' ? '目标' : '来源新名', { disabled: true, replaceString: '新内容' });
    const [from, to] = pair([incoming], existing);
    const p = plan(from, to, [0], { 0: 'replace' });
    assert.deepEqual(p.stats, { added: 0, replaced: 1, skipped: 0 });
    assert.deepEqual(p.rules[0], existing[0]); assert.deepEqual(p.rules[2], existing[2]);
    assert.deepEqual(p.rules[1], { ...incoming, id: 'stable' });
    assert.equal(p.rows[0].targetIndex, 1);
  }
});

test('正则缝合名称和编号指向不同目标时必须点选唯一一条，只替换指定位置', () => {
  const existing = [rule('source-id', '目标甲'), rule('target-id', '同名'), rule('third-id', '同名')];
  const [from, to] = pair([rule('source-id', '同名', { replaceString: '来源内容' })], existing);
  const preview = plan(from, to, [0]);
  assert.deepEqual(preview.rows[0].conflicts.map(c => c.index), [0, 1, 2]);
  unchangedOnError(to, () => plan(from, to, [0], { 0: 'replace' }), /明确选择/);
  for (const index of [-1, 3, '1', undefined]) {
    unchangedOnError(to, () => plan(from, to, [0], { 0: { action: 'replace', targetIndex: index } }), /明确选择/);
  }
  for (const index of [0, 1, 2]) {
    const p = plan(from, to, [0], { 0: { action: 'replace', targetIndex: index } });
    assert.equal(p.rules.length, existing.length);
    assert.equal(p.rules[index].id, existing[index].id);
    assert.equal(p.rules[index].replaceString, '来源内容');
    existing.forEach((r, i) => { if (i !== index) assert.deepEqual(p.rules[i], r); });
  }
});

test('正则缝合拒绝两个来源覆盖同一目标，替换无编号目标会生成编号', () => {
  const [from, to] = pair([
    rule('first', '同名', { replaceString: '甲' }), rule('second', '同名', { replaceString: '乙' })
  ], [rule('target', '同名')]);
  unchangedOnError(to, () => plan(from, to, [0, 1], { 0: 'replace', 1: 'replace' }), /多条来源/);
  const [missingSource, missingTarget] = pair([rule('incoming', '同名', { replaceString: '新' })], [rule(undefined, '同名')]);
  const p = plan(missingSource, missingTarget, [0], { 0: 'replace' });
  assert.ok(p.rules[0].id); assert.notEqual(p.rules[0].id, 'incoming');
});

test('正则缝合批次内精确重复只追加一次，预览仍区分原目标重复与来源批次重复', () => {
  const [from, to] = pair([rule('a', '来源重复'), rule('b', '来源重复')]);
  const p = plan(from, to, [1, 0]);
  assert.deepEqual(p.stats, { added: 1, replaced: 0, skipped: 1 });
  assert.equal(p.rows[0].duplicate, false); assert.equal(p.rows[1].duplicate, false);
  assert.equal(p.rows[1].batchDuplicate, true);
  assert.deepEqual(p.rows[1].conflicts, [], '不可把刚追加的规则误报为原目标的冲突');
});

test('正则缝合原目标精确重复在前一条替换后仍跳过，不把刚替换掉的旧版本重新搬回', () => {
  const original = rule('old', '状态栏', { replaceString: '旧版本' });
  const [from, to] = pair([
    rule('new', '状态栏', { replaceString: '新版本' }),
    { ...original, id: 'source-old' }
  ], [original]);
  const p = plan(from, to, [0, 1], { 0: 'replace' });
  assert.deepEqual(p.stats, { added: 0, replaced: 1, skipped: 1 });
  assert.equal(p.rules.length, 1);
  assert.equal(p.rules[0].replaceString, '新版本');
  assert.equal(p.rows[1].duplicate, true); assert.equal(p.rows[1].action, 'skip');
  assert.equal(to.preset.extensions.regex_scripts[0].replaceString, '旧版本', '预览不得提前替换目标');
});

test('正则缝合拒绝越界、非整数和错误的选择方式，不修改任一预设', () => {
  const [from, to] = pair([rule('a', '甲')]);
  const sourceBefore = JSON.stringify(from);
  for (const selection of [[-1], [1], [0.5], ['0'], null, {}]) {
    unchangedOnError(to, () => plan(from, to, selection), /所选正则/);
  }
  unchangedOnError(to, () => plan(from, to, [0], { 0: 'unknown' }), /冲突处理/);
  unchangedOnError(to, () => plan(from, to, [0], { 0: 'replace' }), /明确选择/);
  assert.equal(JSON.stringify(from), sourceBefore);
});

test('正则缝合逐条跳过坏来源，原目标已有的未知或坏记录保留原样', () => {
  const invalid = [null, [], '文本', {}, rule(9, '数字编号'), rule('p', '位置错误', { placement: [2, '6'] }), rule('r', '缺少替换', { replaceString: null })];
  const valid = rule('good', '有效');
  const [from, to] = pair([...invalid, valid], [null, { futureOnly: true }, rule('target', '原有')]);
  const p = plan(from, to, from.preset.extensions.regex_scripts.map((_, index) => index));
  assert.deepEqual(p.stats, { added: 1, replaced: 0, skipped: invalid.length });
  assert.ok(p.rows.slice(0, invalid.length).every(row => row.invalid && row.action === 'skip'));
  assert.deepEqual(p.rules.slice(0, 3), to.preset.extensions.regex_scripts);
  assert.deepEqual(p.rules[3], valid);
  A.applyPresetRegexTransfer(to, p, from);
  assert.deepEqual(to.preset.extensions.regex_scripts.slice(0, 2), [null, { futureOnly: true }]);
  const [brokenFrom, brokenTo] = pair([rule('same-id', '有效来源')], [rule('same-id', { toString: null })]);
  const brokenPlan = plan(brokenFrom, brokenTo, [0]);
  assert.equal(brokenPlan.rows[0].conflicts[0].name, '未命名正则', '坏目标名称也提供安全的冲突说明');
  assert.deepEqual(brokenPlan.rules[0], brokenTo.preset.extensions.regex_scripts[0], '保留坏目标原数据，不猜测修复');
});

test('正则缝合数组格式错误时拒绝整个操作，不将坏字段替换为空数组', () => {
  const good = draft('正常', [rule('a', '甲')]);
  for (const field of [null, {}, '错误', 7]) {
    const bad = { name: '坏预设', preset: { extensions: { regex_scripts: field } } };
    const before = JSON.stringify(bad);
    assert.throws(() => plan(good, bad, [0]), /必须是数组/);
    assert.throws(() => plan(bad, good, []), /必须是数组/);
    assert.equal(JSON.stringify(bad), before);
  }
  for (const extensions of [[], '错误', 1]) {
    const bad = { name: '坏扩展', preset: { extensions } }, before = JSON.stringify(bad);
    assert.throws(() => plan(good, bad, [0]), /扩展数据格式/);
    assert.equal(JSON.stringify(bad), before);
  }
});

test('正则缝合确认前来源或目标正则被编辑时拒绝写入，包含缺失和空数组的区别', () => {
  for (const change of ['source', 'target', 'source-name', 'target-name', 'target-absent']) {
    const [from, to] = pair([rule('a', '甲')], change === 'target-absent' ? undefined : [rule('b', '乙')]);
    if (change === 'target-absent') delete to.preset.extensions.regex_scripts;
    const p = plan(from, to, [0]);
    if (change === 'source') from.preset.extensions.regex_scripts[0].disabled = true;
    if (change === 'target') to.preset.extensions.regex_scripts[0].replaceString = '被其他操作修改';
    if (change === 'source-name') from.name = '另一个来源';
    if (change === 'target-name') to.name = '另一个目标';
    if (change === 'target-absent') to.preset.extensions.regex_scripts = [];
    unchangedOnError(to, () => A.applyPresetRegexTransfer(to, p, from), /已变化/);
  }
});

test('正则缝合确认前方案内容被篡改或缺少来源时拒绝，目标完全不变', () => {
  for (const change of ['content', 'append', 'not-array', 'signature', 'missing-source']) {
    const [from, to] = pair([rule('a', '甲')], [rule('b', '乙')]);
    const p = plan(from, to, [0]);
    if (change === 'content') p.rules[0].replaceString = '意外修改';
    if (change === 'append') p.rules.push(rule('surprise', '意外追加'));
    if (change === 'not-array') p.rules = {};
    if (change === 'signature') p.resultSignature = '改变';
    unchangedOnError(to, () => A.applyPresetRegexTransfer(to, p, change === 'missing-source' ? undefined : from), /已变化/);
  }
});

test('正则缝合只改目标内置正则，保留提示词、每个角色顺序、分组和独立扩展', () => {
  const [from, to] = pair([rule('a', '甲')], [rule('old', '原有')]);
  const gid = to.createGroup('保留分组', ['a']);
  to.setGroupEnabled(gid, false);
  to.dirty = false; to.history = [];
  const before = to.toPreset();
  const p = plan(from, to, [0]);
  to.preset.temperature = 0.25;
  to.preset.prompts[0].content = '预览时其他正文编辑';
  A.applyPresetRegexTransfer(to, p, from);
  const after = to.toPreset();
  const expected = clone(before);
  expected.temperature = 0.25; expected.prompts[0].content = '预览时其他正文编辑';
  expected.extensions.regex_scripts = p.rules;
  assert.deepEqual(after, expected);
});

test('正则缝合沿用真实 Draft 快照、保存重读和撤销，不影响来源或其他配置', () => {
  const [from, to] = pair([rule('incoming', '新规则', { disabled: true, unknown: { keep: true } })], [rule('old', '现有')]);
  const before = to.toPreset(), sourceBefore = from.toPreset();
  const p = plan(from, to, [0]);
  A.validatePresetRegexTransfer(to, p, from);
  to.snapshot('缝合预设正则');
  assert.equal(A.applyPresetRegexTransfer(to, p, from), true);
  assert.equal(to.dirty, true); assert.equal(to.history.length, 1);
  const roundtrip = new A.Draft('保存重读', to.toPreset());
  assert.deepEqual(roundtrip.preset.extensions.regex_scripts, p.rules);
  assert.equal(to.undo(), '缝合预设正则');
  assert.deepEqual(to.toPreset(), before); assert.deepEqual(from.toPreset(), sourceBefore);
  assert.equal(to.history.length, 0);
});

console.log(`${passed} 项预设正则搬运核心检查通过`);
