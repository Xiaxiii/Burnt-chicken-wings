// 推理格式按预设记忆：离开预设时记下，切回时恢复；关闭时不动。先构建并在仓库根目录运行 8765 静态服务。
// 用法：PW_CHROME=/usr/bin/chromium node test/reasoning-follow-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (m) => console.log('✓', m);
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.insertAdjacentHTML('beforeend', '<div id="st-reasoning"><select id="reasoning_select"><option>DeepSeek</option><option>ECoT</option></select><input id="reasoning_prefix"><input id="reasoning_suffix"><input id="reasoning_separator"><input id="reasoning_max_additions"><input type="checkbox" id="reasoning_auto_parse"><input type="checkbox" id="reasoning_add_to_prompts"><input type="checkbox" id="reasoning_show_hidden"><input type="checkbox" id="reasoning_auto_expand"></div><div id="chat"></div>');
    });
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open);
  const A = { name: 'ECoT', auto_parse: true, add_to_prompts: false, auto_expand: false, show_hidden: true, prefix: '<ECoT>', suffix: '</ECoT>', separator: '\n', max_additions: 1 };
  const B = { name: 'DeepSeek', auto_parse: false, add_to_prompts: true, auto_expand: true, show_hidden: false, prefix: '<think>', suffix: '</think>', separator: '\n', max_additions: 2 };
  const names = await page.evaluate((A) => {
    const c = window.SillyTavern.getContext();
    c.powerUserSettings.reasoning = structuredClone(A);
    const m = window.__mock;
    m.names.push('预设乙'); m.presets.push(structuredClone(m.presets[0]));
    return [m.live.preset_settings_openai, '预设乙'];
  }, A);
  const switchTo = (name) => page.evaluate(async (name) => {
    const c = window.SillyTavern.getContext(), m = window.__mock;
    await c.getPresetManager().selectPreset(m.names.indexOf(name));
    await c.eventSource.emit(c.eventTypes.PRESET_CHANGED, { apiId: 'openai', name });
  }, name);
  const now = () => page.evaluate(() => structuredClone(window.SillyTavern.getContext().powerUserSettings.reasoning));
  const dom = () => page.evaluate(() => ({ prefix: document.getElementById('reasoning_prefix').value, parse: document.getElementById('reasoning_auto_parse').checked, select: document.getElementById('reasoning_select').value }));

  // 默认关闭：切换不动推理格式
  await switchTo(names[1]);
  await page.evaluate((B) => { window.SillyTavern.getContext().powerUserSettings.reasoning = structuredClone(B); }, B);
  await switchTo(names[0]);
  assert.deepEqual(await now(), B, '默认关闭时不切换');
  assert.equal(await page.evaluate(() => Object.keys(window.SillyTavern.getContext().extensionSettings.presetAtelier.reasoningByPreset || {}).length), 0, '默认关闭时不记录');
  ok('默认关闭，切换预设不改推理格式、不记录');

  // 在界面上打开开关：记下当前预设（甲）现在的格式
  await page.evaluate((A) => { window.SillyTavern.getContext().powerUserSettings.reasoning = structuredClone(A); window.__presetAtelier.open('more'); }, A);
  await page.click('[data-m="schemes"]').catch(() => {});
  const box = page.locator('[data-o=reasoningfollow]');
  await box.waitFor();
  await box.check();
  await switchTo(names[1]);
  assert.deepEqual(await now(), A, '乙没有记录时保持当前设置');
  await page.evaluate((B) => { window.SillyTavern.getContext().powerUserSettings.reasoning = structuredClone(B); }, B);
  await switchTo(names[0]);
  assert.deepEqual(await now(), A, '切回甲恢复甲的格式');
  assert.deepEqual(await dom(), { prefix: '<ECoT>', parse: true, select: 'ECoT' }, '酒馆面板同步显示');
  assert.equal(await page.evaluate(() => document.getElementById('chat').getAttribute('data-show-hidden-reasoning')), 'true');
  await switchTo(names[1]);
  assert.deepEqual(await now(), B, '切到乙恢复乙的格式');
  assert.deepEqual(await dom(), { prefix: '<think>', parse: false, select: 'DeepSeek' });
  ok('开启后离开预设时记下格式，切回时恢复，并同步酒馆面板');

  await box.uncheck();
  await switchTo(names[0]);
  assert.deepEqual(await now(), B, '关闭后不再切换');
  ok('关闭后切换预设不改推理格式');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
