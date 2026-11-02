// 别的扩展或酒馆主题按输入框类型改样式（方角、白底）时，焦香鸡翅的搜索框、密钥框不受影响；密钥框仍是密码框。
// 先构建并在仓库根目录运行 8765 静态服务。用法：PW_CHROME=/usr/bin/chromium node test/foreign-style-check.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const URL = process.env.PA_TEST_URL || 'http://127.0.0.1:8765/test/site/index.html';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const errors = [];
const ok = (message) => console.log('✓', message);
const FOREIGN = `html body input[type="search"], html body input[type="password"] { border-radius: 0 !important; background: #fff !important; border: 1px solid #ddd !important; margin-bottom: 12px !important; }`;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__presetAtelier?.open);
  await page.addStyleTag({ content: FOREIGN });
  await page.evaluate(() => window.__presetAtelier.open());
  await page.click('#pa-root [data-tool=search]');
  const q = page.locator('#pa-root .pa-searchrow .pa-input');
  await q.waitFor();
  const look = (loc) => loc.evaluate((x) => { const s = getComputedStyle(x); return { radius: s.borderTopLeftRadius, margin: s.marginBottom, type: x.type, mode: x.inputMode, hint: x.enterKeyHint }; });
  const a = await look(q);
  assert.notEqual(a.radius, '0px', '搜索框保持圆角');
  assert.equal(a.margin, '0px', '搜索框下面不多出一截');
  assert.equal(a.mode, 'search'); assert.equal(a.hint, 'search');
  ok('整理页搜索框不受别处按类型改的样式影响，键盘照样是搜索键');

  await page.evaluate(() => window.__presetAtelier.open('more'));
  await page.click('#pa-root [data-a=new]');
  const key = page.locator('.pa-sheet [data-f=key]').first();
  await key.waitFor();
  const k = await look(key);
  assert.equal(k.type, 'password', '密钥框仍是密码框（键盘不记、读屏不念）');
  assert.notEqual(k.radius, '0px', '密钥框保持圆角');
  assert.equal(k.margin, '0px');
  assert.notEqual(await key.evaluate((x) => getComputedStyle(x).backgroundColor), 'rgb(255, 255, 255)', '底色是配色里的，不是外来的纯白');
  ok('密钥框不受别处按类型改的样式影响，仍是密码框');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
