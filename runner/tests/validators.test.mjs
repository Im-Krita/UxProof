import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig,safeName,evidenceType,executeStep } from '../validators.mjs';
import { esc,renderHtml } from '../html.mjs';

const cfg = () => ({baseUrl:'http://127.0.0.1:4180',scenarios:[{title:'demo',steps:[{type:'click',target:'css:#save'}]}],viewports:[{width:390,height:844}]});
test('валидирует корректные данные',()=>assert.ok(validateConfig(cfg())));
test('отвергает сторонние URL-схемы',()=>{const c=cfg();c.baseUrl='file:///etc/passwd';assert.throws(()=>validateConfig(c));});
test('отвергает пустые сценарии',()=>{const c=cfg();c.scenarios=[];assert.throws(()=>validateConfig(c));});
test('отвергает недопустимые действия',()=>{const c=cfg();c.scenarios[0].steps[0].type='eval';assert.throws(()=>validateConfig(c));});
test('нормализует имена для скриншотов',()=>assert.equal(safeName('../../../'), 'item'));
test('рекомендации ИИ не становятся подтвержденными дефектами',()=>assert.equal(evidenceType('ai-ux'),'recommendation'));
test('экранирует HTML при экспорте',()=>assert.equal(esc('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;'));
test('HTML отчет не исполняет пользовательский HTML',()=>{
 const html=renderHtml({project:'<script>',baseUrl:'https://test',startedAt:'now',runId:'1',summary:{passedRuns:0,totalRuns:1,confirmedIssues:1,aiSuggestions:0},issues:[{title:'<b>',kind:'functional',severity:'high',status:'confirmed',scenario:'s',viewport:'m',description:'<img>',screenshot:null}],results:[]});
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
 const poisoned=renderHtml({project:'p',baseUrl:'https://test',startedAt:'now',runId:'1',summary:{passedRuns:0,totalRuns:1,confirmedIssues:0,aiSuggestions:0},issues:[{title:'x',kind:'functional',severity:'high',status:'confirmed',scenario:'s',viewport:'m',description:'d',screenshot:'../secret.png'}],results:[]});
 assert.ok(!poisoned.includes('secret.png'));
});
test('проверяет ожидаемый текст и значение шагов',async()=>{
 const page={locator:()=>({waitFor:async()=>{},textContent:async()=> 'Статус: подключено',inputValue:async()=> 'v1'})};
 await executeStep(page,{type:'expectText',target:'css:#status',value:'подключено'},'http://example.test');
 await assert.rejects(()=>executeStep(page,{type:'expectValue',target:'css:#v',value:'v2'},'http://example.test'));
});
test('ошибки проверок не включают ожидаемые или фактические значения',async()=>{
 const page={locator:()=>({waitFor:async()=>{},textContent:async()=> 'actual-secret',inputValue:async()=> 'actual-secret'})};
 for (const type of ['expectText','expectValue']) {
  await assert.rejects(()=>executeStep(page,{type,target:'css:#status',value:'expected-secret'},'http://example.test'), error=>{
   assert.ok(!error.message.includes('expected-secret'));
   assert.ok(!error.message.includes('actual-secret'));
   return true;
  });
 }
});
test('отвергает метадата-адрес и пустой ожидаемый текст',()=>{
 const metadata=cfg(); metadata.baseUrl='http://169.254.169.254/latest'; assert.throws(()=>validateConfig(metadata));
 const empty=cfg(); empty.scenarios[0].steps[0]={type:'expectText',target:'css:#status',value:' '}; assert.throws(()=>validateConfig(empty));
});
test('не пускает переход на другой сайт и javascript',()=>{
 const hop=cfg(); hop.scenarios[0].steps[0]={type:'navigate',value:'https://example.com/steal'}; assert.throws(()=>validateConfig(hop));
 const script=cfg(); script.scenarios[0].steps[0]={type:'navigate',value:'javascript:alert(1)'}; assert.throws(()=>validateConfig(script));
});
test('navigate остаётся в origin проекта',async()=>{
 const page={goto:async()=>{throw Error('не должен открыть чужой адрес');}};
 await assert.rejects(()=>executeStep(page,{type:'navigate',value:'https://evil.example/'},'http://127.0.0.1:4180'), /пределах адреса проекта/);
 let opened='';
 await executeStep({goto:async url=>{opened=url;}},{type:'navigate',value:'/fixed'},'http://127.0.0.1:4180/');
 assert.equal(opened,'http://127.0.0.1:4180/fixed');
});
