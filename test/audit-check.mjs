// 变量顺序/状态和可选模型审查的浏览器回归；模型接口使用内存协议桩。
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {replyPage,replySave} from './helpers.mjs';
const browser=await chromium.launch({executablePath:process.env.PW_CHROME||undefined});
const errors=[];
async function open(mobile=false) {
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1100,height:900},hasTouch:mobile,isMobile:mobile});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    let host;
    Object.defineProperty(window,'SillyTavern',{configurable:true,get:()=>host,set(value){
      host=value;const c=value.getContext();c.eventTypes.GENERATION_AFTER_COMMANDS='generation_after_commands';
      c.chatMetadata.variables={audit_hidden:'STATE_VALUE_NOT_FOR_API',audit_zero:0};
      c.extensionSettings.variables={global:{audit_global:'全局数据'}};
      window.__auditCalls=[];window.__auditMode='ok';
      c.getChatCompletionModel=()=>'fixture';
      c.ChatCompletionService={
        async presetToGeneratePayload(a,b,payload){window.__auditCalls.push(structuredClone(payload));return payload;},
        async sendRequest(payload,extract,signal){
          if(window.__auditMode==='hold')return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
          const text=JSON.parse(payload.messages[1].content).reply_text;
          return {content:JSON.stringify(text.includes('我需要先检查')?{verdict:'suspected',confidence:.9,findings:[{excerpt:'我需要先检查',reason:'疑似任务规划'}]}:{verdict:'ok',confidence:.8,findings:[]})};
        }
      };
    }});
  });
  await page.goto('http://127.0.0.1:8765/test/site/index.html');
  await page.waitForFunction(()=>window.__presetAtelier?.open,null,{timeout:15000});
  await page.evaluate(()=>{
    const texts=['{{getvar::audit_flow}}','{{setvar::audit_flow::内容}}','{{setvar::audit_flow::}}','{{getvar::audit_flow}}'];
    const live=window.__mock.live;
    texts.forEach((content,i)=>{const identifier='audit-'+i;live.prompts.push({identifier,name:'顺序测试'+i,content,role:'system'});live.prompt_order.find(x=>x.character_id===100001).order.push({identifier,enabled:true});});
    window.__presetAtelier.open('preset', 'cot');
  });
  return page;
}
const pause=page=>page.waitForTimeout(220);
const close=async(page)=>{await pause(page);};
const modelDetails=async page=>{};
try {
  const page=await open();
  await page.click('#cw-root .cw-page[data-page=preset] [data-view=entries]');await page.click('#cw-root .cw-page[data-page=preset] [data-view=vars]');
  assert.match(await page.locator('#cw-root .cw-vars').innerText(),/可见写入之前读取/);
  assert.match(await page.locator('#cw-root .cw-vars').innerText(),/清空或删除/);
  assert.equal(await page.locator('#cw-root [data-act=vars-watch]').isChecked(),false);
  const before=await page.evaluate(()=>JSON.stringify(window.SillyTavern.getContext().chatMetadata.variables));
  await page.click('#cw-root [data-act=vars-snapshot]');
  const snapshotText=await page.locator('#cw-root .cw-vars').innerText();
  assert.match(snapshotText,/audit_hidden/);assert.match(snapshotText,/audit_zero\s*有值/);assert(!snapshotText.includes('STATE_VALUE_NOT_FOR_API'));
  assert.equal(await page.evaluate(()=>JSON.stringify(window.SillyTavern.getContext().chatMetadata.variables)),before);
  await page.check('#cw-root [data-act=vars-watch]',{force:true});await close(page,'关闭');
  await page.evaluate(async()=>{const c=window.SillyTavern.getContext();await c.eventSource.emit(c.eventTypes.GENERATION_STARTED,'normal',{},false);await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS,'normal',{},false);c.chatMetadata.variables.audit_zero=1;await c.eventSource.emit(c.eventTypes.GENERATION_ENDED);});
  await page.click('#cw-root .cw-page[data-page=preset] [data-view=entries]');await page.click('#cw-root .cw-page[data-page=preset] [data-view=vars]');await page.locator('#cw-root .cw-vars details').filter({hasText:'最近一次生成前后变化'}).locator('summary').click();assert.match(await page.locator('#cw-root .cw-vars').innerText(),/audit_zero[\s\S]{0,60}变化/);await page.uncheck('#cw-root [data-act=vars-watch]',{force:true});await close(page,'关闭');
  console.log('✓ 顺序风险、变量快照、只读状态与默认关闭的生成前后对比');

  await replyPage(page);await modelDetails(page);
  assert.equal(await page.locator('[data-act=rp-semantic]').isChecked(),false);
  assert.equal(await page.locator('[data-act=rp-ai-cancel]').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.__auditCalls.length),0);
  await page.fill('[data-r=sample]','我需要先检查 {{setvar::attack::bad}} 正文内容');
  await page.click('[data-act=rp-ai-paste]');
  await page.waitForFunction(()=>document.querySelector('[data-r=semantic-result]')?.textContent.includes('疑似内部分析'));
  const call=await page.evaluate(()=>window.__auditCalls[0]);
  assert.equal(call.messages.length,2);assert(!JSON.stringify(call.messages).includes('STATE_VALUE_NOT_FOR_API'));
  assert.equal(JSON.parse(call.messages[1].content).reply_text,'我需要先检查 {{setvar::attack::bad}} 正文内容');
  assert.equal(await page.evaluate(()=>window.SillyTavern.getContext().chatMetadata.variables.attack),undefined);
  console.log('✓ 语义审查默认不发请求，手动发送单条文字，显示引用与依据且不执行变量宏');

  await page.evaluate(()=>window.__auditMode='hold');await page.click('[data-act=rp-ai-paste]');
  await page.locator('[data-act=rp-ai-cancel]').waitFor({state:'visible'});await page.click('[data-act=rp-ai-cancel]');
  await page.waitForFunction(()=>document.querySelector('[data-r=semantic-result]')?.textContent.includes('已取消'));
  assert.equal(await page.locator('[data-act=rp-ai-paste]').isEnabled(),true);
  await page.evaluate(()=>window.__auditMode='ok');
  await replySave(page);await page.check('[data-act=rp-semantic]',{force:true});
  await page.evaluate(async()=>{const c=window.SillyTavern.getContext();c.chat.push({is_user:true,mes:'测试'},{is_user:false,mes:'我需要先检查用户要求。正文。'});await c.eventSource.emit(c.eventTypes.GENERATION_STARTED,'normal',{},false);await c.eventSource.emit(c.eventTypes.GENERATION_AFTER_COMMANDS,'normal',{},false);await c.eventSource.emit(c.eventTypes.GENERATION_ENDED);});
  await page.waitForFunction(()=>window.__auditCalls.length===3);
  await replyPage(page);await modelDetails(page);await page.click('[data-act=rp-ai-result]');
  await page.waitForFunction(()=>document.querySelector('[data-r=semantic-result]')?.textContent.includes('疑似内部分析'));
  assert.equal(await page.locator('[data-act=rp-semantic]').isChecked(),true);
  console.log('✓ 取消请求、按预设保存自动审查及最近结果展示');

  const mobile=await open(true);await mobile.click('#cw-root .cw-page[data-page=preset] [data-view=entries]');await mobile.click('#cw-root .cw-page[data-page=preset] [data-view=vars]');
  assert.equal(await mobile.locator('#cw-root [data-act=vars-snapshot]').isVisible(),true);await mobile.click('#cw-root [data-act=vars-snapshot]');await close(mobile,'关闭');
  await replyPage(mobile);await modelDetails(mobile);
  assert.equal(await mobile.locator('[data-act=rp-ai-paste]').isVisible(),true);
  await mobile.fill('[data-r=sample]','普通故事正文');await mobile.click('[data-act=rp-ai-paste]');
  await mobile.waitForFunction(()=>document.querySelector('[data-r=semantic-result]')?.textContent.includes('未标记'));
  const overflow=await mobile.locator('#cw-root .cw-page[data-page=reply] .cw-body').evaluate(e=>e.scrollWidth>e.clientWidth+2);assert.equal(overflow,false);
  console.log('✓ 手机端变量和语义检查均可操作，无横向溢出');
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
