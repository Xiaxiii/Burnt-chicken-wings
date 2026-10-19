import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { choose, chooseSrcType } from './choose.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const order = JSON.parse(fs.readFileSync(path.join(root, 'order.json'), 'utf8'));
let bundle = "var BUILD_KIND='extension',VERSION='正则缝制合成回归',CHANGELOG='';\n";
for (const file of order) {
  const content = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  bundle += file.endsWith('.css') ? `\nvar style_default=${JSON.stringify(content)};\n` : `\n${content}\n`;
}
// 仅供本地回归观察真实草稿与失效机制；测试不替换计划、应用或保存逻辑。
bundle += '\nglobalThis.__regexTransferTest={getDraft,notifyDraft,setFocusPreset,dropDraft,getRefreshName:()=>presetRegexRefreshName};\n';
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/index.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle); }
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const content = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const targetName = '正则缝制目标（公开合成）', sourceName = '状态栏正则来源（公开合成）';
const regex = (id, scriptName, extra = {}) => ({ id, scriptName, findRegex: '/\\[状态\\]([\\s\\S]*?)\\[\\/状态\\]/g', replaceString: '<div class="status">$1</div>', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: 0, maxDepth: null, ...extra });
const exact = regex('exact', '已存在的相同美化');
const maliciousHtml = '<img src=x onerror="window.__regexPwn=1"><script>window.__regexPwn=2</script><div>$1</div>';
const sourceRules = [
  regex('new-style', '来源美化 <img src=x onerror="window.__regexPwn=3">', { replaceString: maliciousHtml, nativeExtra: { preserve: ['来源自定义字段', 7] } }),
  exact,
  regex('source-conflict', '同名状态栏', { replaceString: '<section class="new">$1</section>' }),
  regex('source-off', '来源关闭的美化', { disabled: true, minDepth: 2, maxDepth: 5 }),
  regex('prompt', '发送内容处理', { markdownOnly: false, promptOnly: true, replaceString: '$1' }),
  regex('unrestricted', '通用处理', { markdownOnly: false, promptOnly: false, replaceString: '$1' })
];
const target = {
  temperature: 0.71,
  prompts: [{ identifier: 'existing', name: '既有正文', content: '不改提示词内容', role: 'system' }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'existing', enabled: false }] }],
  extensions: { regex_scripts: [exact, regex('target-conflict', '同名状态栏', { replaceString: '<article class="old">$1</article>' }), regex('target-kept', '目标其他规则', { disabled: true })], unrelated: { preserved: 42 } }
};
const source = { prompts: [{ identifier: 'source-prompt', name: '来源提示词', content: '不必选择提示词即可缝正则', role: 'system' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'source-prompt', enabled: true }] }], extensions: { regex_scripts: sourceRules, unrelatedSource: true } };
const errors = [];
const equal = (a, b, label) => assert.deepEqual(a, b, label);
const stored = (page, name = targetName) => page.evaluate(name => structuredClone(window.__mock.presets[window.__mock.names.indexOf(name)]), name);
const dialog = page => page.getByRole('dialog', { name: '缝合预设正则', exact: true });
async function boot(width, targetPreset = target) {
  const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 900 }, isMobile: width < 500, hasTouch: width < 500 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/test/site/index.html`);
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.evaluate(({ target, source, targetName, sourceName }) => {
    const m = window.__mock;
    m.names.splice(0, m.names.length, targetName, sourceName);
    m.presets.splice(0, m.presets.length, structuredClone(target), structuredClone(source));
    m.live.preset_settings_openai = targetName;
    Object.assign(m.live, structuredClone(target));
    const settings = window.SillyTavern.getContext().extensionSettings;
    settings.regex = [{ id: 'global-kept', scriptName: '全局规则保持原样' }];
    settings.preset_allowed_regex = { openai: ['其他授权预设'] };
    window.__presetAtelier.open('suture');
  }, { target: targetPreset, source, targetName, sourceName });
  await choose(page, '.pa-src-name', sourceName);
  await choose(page, '.pa-dst-picker .pa-namebtn', targetName);
  return page;
}
async function openRegex(page) {
  assert.equal(await page.locator('[data-st=go]').isDisabled(), true, '无需选择提示词或位置');
  await page.click('[data-st=regex]');
  await dialog(page).waitFor();
}
async function waitSaved(page, count) {
  await page.waitForFunction(({ name, count }) => {
    const m = window.__mock;
    return m.presets[m.names.indexOf(name)].extensions.regex_scripts.length === count;
  }, { name: targetName, count });
}
async function cancel(page) {
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForTimeout(190);
}
try {
  for (const width of [390, 1100]) {
    const page = await boot(width);
    await openRegex(page);
    const d = dialog(page);
    assert.match(await d.locator('[data-rx-activation]').innerText(), /尚未允许.*酒馆「正则」面板/);
    if (width === 390) {
      await page.evaluate(name => {
        const settings = window.SillyTavern.getContext().extensionSettings;
        settings.preset_allowed_regex.openai.push(name);
        window.__regexTransferTest.notifyDraft(name, 'status');
      }, targetName);
      assert.match(await d.locator('[data-rx-activation]').innerText(), /已允许使用内置正则/);
      await page.evaluate(name => {
        window.SillyTavern.getContext().extensionSettings.disabledExtensions = ['regex'];
        window.__regexTransferTest.notifyDraft(name, 'status');
      }, targetName);
      assert.match(await d.locator('[data-rx-activation]').innerText(), /全局停用.*开启正则功能/);
      await page.evaluate(name => {
        const settings = window.SillyTavern.getContext().extensionSettings;
        settings.preset_allowed_regex = { openai: ['其他授权预设'] };
        settings.disabledExtensions = [];
        window.__regexTransferTest.notifyDraft(name, 'status');
      }, targetName);
      assert.match(await d.locator('[data-rx-activation]').innerText(), /尚未允许/);
    }
    assert.match(await d.getByText('状态栏仍需配套提示词或世界书', { exact: false }).textContent(), /相应的标签和格式/);
    equal(await d.locator('[data-rx-select]').evaluateAll(inputs => inputs.filter(x => x.checked).map(x => Number(x.dataset.rxSelect))), [0, 1, 2, 3], '默认只选显示美化');
    assert.match(await d.locator('[data-rx-index="3"]').innerText(), /来源关闭/);
    assert.match(await d.locator('[data-rx-index="1"]').innerText(), /相同规则.*跳过/);
    assert.equal(await d.locator('[data-rx-conflict="2"]').inputValue(), 'keep');
    assert.equal(await d.locator('img,script,iframe').count(), 0, '名称与 HTML 尚未变成 DOM');
    await d.locator('[data-rx-details="0"] summary').click();
    assert.equal(await d.locator('[data-rx-details="0"] pre').nth(1).textContent(), maliciousHtml);
    assert.equal(await d.locator('img,script,iframe').count(), 0, '展开替换内容也只显示文本');
    assert.equal(await page.evaluate(() => window.__regexPwn || 0), 0);
    await d.locator('[data-rx-search]').fill('同名状态栏');
    assert.equal(await d.locator('[data-rx-index]:visible').count(), 1);
    await d.locator('[data-rx-search]').fill('');
    equal(await stored(page), target, '纯预览不改目标');
    equal(await stored(page, sourceName), source, '纯预览不改来源');
    await cancel(page);
    equal(await stored(page), target, '取消不改目标');
    await openRegex(page);
    await d.locator('[data-rx-order] summary').click();
    await d.locator('[data-rx-final-order] li').first().waitFor();
    equal(await d.locator('[data-rx-final-order] li').evaluateAll(nodes => nodes.map(n => n.firstChild.textContent.trim())), [...target.extensions.regex_scripts.map(r => r.scriptName), sourceRules[0].scriptName, sourceRules[2].scriptName, sourceRules[3].scriptName], '保留两份时的最终真实顺序');
    await d.locator('[data-rx-conflict="2"]').selectOption('skip');
    assert.equal(await d.locator('[data-rx-final-order] li').count(), 5, '跳过冲突只搬两条新规则');
    await d.locator('[data-rx-conflict="2"]').selectOption('replace');
    assert.equal(await d.locator('[data-rx-final-order] li').count(), 5, '明确替换保留目标位置');
    assert.equal(await d.locator('[data-rx-final-order] li').nth(1).evaluate(n => n.firstChild.textContent.trim()), sourceRules[2].scriptName);
    await d.locator('[data-rx-conflict="2"]').selectOption('keep');
    await d.locator('[data-rx-pick=all]').click();
    assert.equal(await d.locator('[data-rx-select]:checked').count(), 6, '影响发送的规则也可主动手选');
    assert.equal(await d.locator('[data-rx-final-order] li').count(), 8);
    await d.locator('[data-rx-pick=none]').click();
    assert.equal(await d.getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), true);
    await d.locator('[data-rx-pick=display]').click();
    assert.equal(await d.locator('[data-rx-select]:checked').count(), 4);
    const overflow = await d.evaluate(n => [...n.querySelectorAll('.pa-sheet-body, .pa-regex-transfer, .pa-card')].some(x => x.scrollWidth > x.clientWidth + 2));
    assert.equal(overflow, false, '手机与桌面预览均不横向溢出');
    fs.mkdirSync(path.join(root, 'test/shots'), { recursive: true });
    if (width < 500) await d.screenshot({ path: path.join(root, 'test/shots/regex-transfer-phone.png') });
    await d.getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 6);
    const saved = await stored(page);
    equal(saved.extensions.regex_scripts.slice(0, 3), target.extensions.regex_scripts, '原有规则顺序与内容保持');
    equal(saved.extensions.regex_scripts.slice(3).map(({ id, ...rest }) => rest), [sourceRules[0], sourceRules[2], sourceRules[3]].map(({ id, ...rest }) => rest), '新增完整原生字段与 disabled 状态保留');
    equal({ ...saved, extensions: { ...saved.extensions, regex_scripts: [] } }, { ...target, extensions: { ...target.extensions, regex_scripts: [] } }, '提示词、参数、分组与其他扩展不改');
    equal(await stored(page, sourceName), source, '确认也不改来源');
    equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.preset_allowed_regex), { openai: ['其他授权预设'] }, '不擅自扩大原生启用授权');
    equal(await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.regex), [{ id: 'global-kept', scriptName: '全局规则保持原样' }]);
    await page.click('[data-g=undo]');
    await waitSaved(page, 3);
    equal(await stored(page), target, '撤销恢复整份目标');
    console.log(`✓ 正则缝制 ${width}px：默认美化/来源开关、全选清空、重复与冲突、最终顺序、安全文本、保存撤销及授权范围`);
    await page.close();
  }
  {
    const page = await boot(390);
    await page.evaluate(({ targetName }) => {
      const c = window.SillyTavern.getContext();
      c.extensionSettings.preset_allowed_regex.openai.push(targetName);
      c.extensionSettings.disabledExtensions = [];
      window.__regexSourceNode = document.querySelector('.pa-src-name');
      window.__nativeRegexEvents = [];
      // 模拟原生面板只监听实际事件、读取已同步的当前预设数据；不替换宿主保存和刷新实现。
      c.eventSource.on(c.eventTypes.PRESET_CHANGED, (event) => {
        window.__nativeRegexEvents.push({ event: structuredClone(event), rules: structuredClone(window.__mock.live.extensions.regex_scripts),
          sourceConnected: window.__regexSourceNode.isConnected,
          sourceSame: window.__regexSourceNode === document.querySelector('.pa-src-name'),
          refreshName: window.__regexTransferTest.getRefreshName() });
      });
    }, { targetName });
    await openRegex(page);
    assert.match(await dialog(page).locator('[data-rx-activation]').innerText(), /已允许使用内置正则/);
    await dialog(page).getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 6);
    await page.waitForFunction(() => window.__nativeRegexEvents.length === 1 && window.__regexTransferTest.getRefreshName() === null);
    let nativeEvents = await page.evaluate(() => window.__nativeRegexEvents);
    equal(nativeEvents[0].event, { apiId: 'openai', name: targetName }, '已允许目标收到真实原生刷新事件');
    equal(nativeEvents[0].rules, (await stored(page)).extensions.regex_scripts, '原生监听读取到保存后的新规则');
    assert.equal(nativeEvents[0].sourceConnected && nativeEvents[0].sourceSame, true, '自身刷新不重画来源 DOM');
    assert.equal(nativeEvents[0].refreshName, targetName, '自身事件派发期间持有精确预设标记');
    assert.equal(await page.locator('.pa-src-name').innerText(), sourceName + '\n▾');
    assert.equal(await page.locator('[data-st=go]').isDisabled(), true, '仍未选提示词或位置');
    equal(await stored(page, sourceName), source, '刷新没有修改来源');
    await page.click('[data-g=undo]');
    await waitSaved(page, 3);
    await page.waitForFunction(() => window.__nativeRegexEvents.length === 2 && window.__regexTransferTest.getRefreshName() === null);
    nativeEvents = await page.evaluate(() => window.__nativeRegexEvents);
    equal(nativeEvents[1].rules, target.extensions.regex_scripts, '撤销后的原生监听也读取到恢复规则');
    assert.equal(nativeEvents[1].sourceConnected && nativeEvents[1].sourceSame, true, '撤销刷新同样保留来源 DOM');
    equal(await stored(page), target, '已授权目标也能完整撤销');
    const naturalSourceName = '真正预设变化后刷新的来源条目';
    await page.evaluate(async ({ sourceName, targetName, naturalSourceName }) => {
      const m = window.__mock;
      m.presets[m.names.indexOf(sourceName)].prompts[0].name = naturalSourceName;
      const c = window.SillyTavern.getContext();
      await c.eventSource.emit(c.eventTypes.PRESET_CHANGED, { apiId: 'openai', name: targetName });
    }, { sourceName, targetName, naturalSourceName });
    assert.equal(await page.locator('.pa-src-list [data-id="source-prompt"] .pa-name').innerText(), naturalSourceName, '随后真实预设变化照常重新读取来源');
    assert.equal(await page.evaluate(() => window.__regexSourceNode.isConnected), false, '自然事件仍正常刷新页面，而非被旧 guard 吞掉');
    nativeEvents = await page.evaluate(() => window.__nativeRegexEvents);
    assert.equal(nativeEvents.length, 3);
    assert.equal(nativeEvents[2].refreshName, null, 'finally 已清理自身刷新标记');
    console.log('✓ 已授权原生刷新：读到新规则、自身保存及撤销保留来源 DOM，自然预设事件仍正常刷新');
    await page.close();
  }
  {
    const ambiguous = structuredClone(target);
    ambiguous.extensions.regex_scripts.push(regex('second-conflict', '同名状态栏', { replaceString: '<aside class="old-second">$1</aside>' }));
    const page = await boot(390, ambiguous);
    await openRegex(page);
    const d = dialog(page);
    await d.locator('[data-rx-conflict="2"]').selectOption('replace');
    assert.equal(await d.locator('[data-rx-replace="2"]').inputValue(), '', '不猜测多个冲突中的替换目标');
    assert.equal(await d.getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), true);
    await d.locator('[data-rx-replace="2"]').selectOption('3');
    assert.equal(await d.getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), false);
    await d.getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 6);
    const saved = await stored(page);
    equal(saved.extensions.regex_scripts[1], ambiguous.extensions.regex_scripts[1], '未选中的同名目标不改');
    equal(saved.extensions.regex_scripts[3], { ...sourceRules[2], id: 'second-conflict' }, '只替换指定规则，保留目标 ID 和位置');
    equal(await stored(page, sourceName), source);
    console.log('✓ 多个同名冲突：必须明确选择单条替换目标，不覆盖其他规则');
    await page.close();
  }
  for (const changed of ['source', 'target', 'identity', 'focus']) {
    const page = await boot(390);
    await openRegex(page);
    await page.evaluate(({ changed, sourceName, targetName }) => {
      const api = window.__regexTransferTest;
      if (changed === 'focus') return api.setFocusPreset(sourceName);
      if (changed === 'identity') { api.dropDraft(targetName); api.getDraft(targetName); api.notifyDraft(targetName, 'content'); return; }
      const name = changed === 'source' ? sourceName : targetName;
      api.getDraft(name).preset.extensions.regex_scripts.push({ id: 'changed', scriptName: '规则列表在预览后发生变化' });
      api.notifyDraft(name, 'content');
    }, { changed, sourceName, targetName });
    assert.equal(await dialog(page).locator('[data-rx-stale]').isVisible(), true);
    assert.equal(await dialog(page).getByRole('button', { name: '确认缝合正则', exact: true }).isDisabled(), true);
    await cancel(page);
    equal(await stored(page), target, '失效计划没有写入原目标');
    equal(await stored(page, sourceName), source, '失效计划没有写入来源');
    console.log(`✓ 正则预览过期保护：${changed}`);
    await page.close();
  }
  {
    const page = await boot(390);
    await chooseSrcType(page, 'file');
    const fileSource = { prompts: [], extensions: { regex_scripts: sourceRules } };
    await page.locator('.pa-src-pick input[type=file]').setInputFiles({ name: '仅含正则的完整预设.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fileSource)) });
    await openRegex(page);
    assert.equal(await dialog(page).locator('[data-rx-index]').count(), 6, '完整 JSON 文件无需提示词条目也能独立缝制');
    await dialog(page).getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 6);
    assert.equal((await stored(page)).extensions.regex_scripts.at(-1).disabled, true);
    equal(await stored(page, sourceName), source, '文件搬运不改任何已保存来源预设');
    console.log('✓ 完整预设 JSON：不选择提示词和位置即可独立缝制，原生关闭状态保留');
    await page.close();
  }
  {
    const page = await boot(390);
    await chooseSrcType(page, 'file');
    const malformed = { scriptName: { toString: null }, id: { toString: null }, findRegex: { toString: null }, replaceString: { toString: null }, placement: [{ toString: null }], markdownOnly: true };
    const fileSource = { prompts: [], extensions: { regex_scripts: [sourceRules[0], malformed] } };
    await page.locator('.pa-src-pick input[type=file]').setInputFiles({ name: '包含损坏规则的预设.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fileSource)) });
    await openRegex(page);
    const d = dialog(page);
    assert.equal(await d.locator('[data-rx-select="1"]').isDisabled(), true, '损坏规则可以看到但不能搬运');
    assert.equal(await d.locator('[data-rx-select]:checked').count(), 1);
    await d.locator('[data-rx-details="1"] summary').click();
    await d.locator('[data-rx-details="1"] pre').first().waitFor();
    assert.match(await d.locator('[data-rx-details="1"] [data-rx-code]').innerText(), /查找表达式格式无效.*替换文本格式无效/s);
    await d.getByRole('button', { name: '确认缝合正则', exact: true }).click();
    await waitSaved(page, 4);
    equal((await stored(page)).extensions.regex_scripts.slice(0, 3), target.extensions.regex_scripts);
    assert.equal((await stored(page)).extensions.regex_scripts[3].id, sourceRules[0].id);
    console.log('✓ 损坏的规则字段：单条禁选并安全展示，不阻塞有效规则搬运');
    await page.close();
  }
  assert.deepEqual(errors, [], '无页面脚本异常');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
