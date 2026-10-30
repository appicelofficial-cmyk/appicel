const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, mocks = {}, env = {}) {
 const exports = {};
 const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
 vm.runInNewContext(code, { exports, URL, Date, console, process: { env }, require: name => name in mocks ? mocks[name] : require(name) });
 return exports;
}
const links = load('lib/post-links.ts');
const good = ['http://example.com', 'https://example.com/a?x=1&y=2#part', 'example.com', 'https://日本語.jp/投稿', '日本語.jp', 'https://bit.ly/abc', '  HTTPS://Example.COM/a  ', 'https://user:pass@example.com:8443/a', 'https://example.com/' + 'a'.repeat(10000), '', '   '];
const bad = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hello', 'file:///tmp/a', 'ftp://example.com', ' java\nscript:alert(1)', '\tHTTPS://example.com', 'https://exa\tmple.com', 'https://example.com/\u0000', 'https://example.com/\u007f', 'https://example.com/\u0085', 'https://', 'not a url', 'https://[broken', 'https://example.com:bad', 'https://%zz'];
test('shared validator permits ordinary URLs without domain, length or credential restrictions', () => {
 for (const value of good) assert.equal(links.validatePostLink(value).ok, true, value);
 assert.equal(links.validatePostLink('example.com').url, 'https://example.com/');
 assert.equal(links.validatePostLink('日本語.jp').url, new URL('https://日本語.jp').href);
 for (const value of bad) assert.equal(links.validatePostLink(value).ok, false, JSON.stringify(value));
 for (const value of [12, {}, false]) assert.equal(links.validatePostLink(value).ok, false);
});
test('display guard disables invalid and blank legacy links and normalizes valid links', () => {
 for (const value of [...bad, '', null]) assert.equal(links.postLinkHref(value), undefined);
 assert.equal(links.postLinkHref('example.com'), 'https://example.com/');
});
function setup(name, payload, options = {}) {
 const calls = [];
 const chain = table => {
  const q = {};
  for (const method of ['select','eq','in','gte','gt','lt','delete','insert','update']) q[method] = (...args) => { calls.push({table, method, args}); return q; };
  q.single = async () => ({data: table === 'pending_cell_orders' && name === 'stripe-webhook' ? { id: 'order', status: options.orderStatus || 'pending', cell_payload: payload } : {id:'created'}, error:null});
  q.maybeSingle = async () => ({data:options.existingCell || null,error:null});
  q.then = resolve => resolve({data:null,error:null,count:0});
  return q;
 };
 class Stripe {
  constructor() { this.checkout = {sessions: {create: async value => { calls.push({checkout:value}); return {id:'session',url:'https://checkout.stripe.test'}; }}}; this.refunds = {create: async (...args) => { calls.push({refund:args}); return {id:'refund',status:'succeeded'}; }}; this.webhooks = {constructEvent: () => { if (options.badSignature) throw Error('invalid signature'); return {type:'checkout.session.completed',data:{object:{id:'session',payment_status:options.paymentStatus || 'paid',payment_intent:'pi_test'}}}; }}; }
 }
 const env = {NODE_ENV:'production',VERCEL:'1',NEXT_PUBLIC_SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake',STRIPE_SECRET_KEY:'fake',STRIPE_WEBHOOK_SECRET:'fake'};
 const mocks = {
  '../../../lib/post-links': links,
  'next/server': {NextResponse:{json:(data, options) => ({data,status:options?.status || 200,headers:options?.headers})}},
  '@supabase/supabase-js':{createClient:()=>({from:chain,rpc:async()=>({data:{allowed:true,retry_after:0},error:null})})}, stripe:Stripe,
 };
 mocks['../../../lib/posting-rate-limit'] = load('lib/posting-rate-limit.ts',mocks,env);
 const route = load(`app/api/${name}/route.ts`, mocks, env);
 return {calls, post: body => route.POST({json:async()=>body, text:async()=>'',headers:new Headers({'stripe-signature':'fake','x-vercel-forwarded-for':'203.0.113.1'}),url:'https://app.invalid/api'})};
}
const base = {title:'test',viewerId:'viewer',images:[{image_url:'image-unchanged',original_image_url:'original-unchanged'}]};
for (const name of ['create-cell','create-checkout-session']) {
 test(`${name}: invalid array and legacy links rejected before DB/Checkout`, async () => {
  for (const value of bad) for (const legacy of [false,true]) {
   const {calls,post} = setup(name);
   const result = await post({...base,planId:name==='create-cell'?'normal_free_1d':'normal_1d',...(legacy?{link_url:value}:{links:[{link_url:value}]})});
   assert.equal(result.status,400,JSON.stringify(value)); assert.equal(calls.length,0);
  }
 });
 test(`${name}: valid links are normalized in saved payload; image and return URLs retain their purpose`, async () => {
  for (const value of good) {
   const {calls,post} = setup(name);
   assert.equal((await post({...base,planId:name==='create-cell'?'normal_free_1d':'normal_1d',links:[{link_url:value}]})).status,200);
   const record=calls.find(c=>c.method==='insert' && c.table===(name==='create-cell'?'cells':'pending_cell_orders')).args[0][0];
   const payload=name==='create-cell'?record:record.cell_payload;
   assert.equal(payload.link_url, links.validatePostLink(value).url || null);
   assert.equal(payload.image_url,'image-unchanged');
   if(name!=='create-cell') assert.equal(calls.find(c=>c.checkout).checkout.cancel_url,'https://app.invalid/?payment=cancel');
  }
 });
}
test('webhook drops invalid legacy/array links and still creates cell and marks order paid', async () => {
 for(const value of bad) for(const legacy of [true,false]) {
  const payload = {...base, link_type:'other', link_url:legacy ? value : null, links:legacy ? [] : [{link_url:value}]};
  const {calls,post}=setup('stripe-webhook',payload);
  assert.equal((await post()).status,200);
  const cell=calls.find(c=>c.table==='cells' && c.method==='insert').args[0][0];
  assert.equal(cell.link_url,null);
  assert.equal(cell.link_type,null);
  assert.equal(calls.some(c=>c.table==='cell_links' && c.method==='insert'),false);
  assert.equal(calls.find(c=>c.table==='pending_cell_orders' && c.method==='update').args[0].status,'paid');
  assert.equal(payload.link_url,legacy ? value : null);
 }
});
test('webhook preserves valid links around invalid links without changing images or original order', async () => {
 const payload={...base,link_url:'javascript:alert(1)',links:[
  {link_type:'other',link_url:'example.com'},
  {link_url:'data:text/html,bad'},
  {link_type:'other',link_url:'https://bit.ly/abc?q=1#part'},
 ]};
 const before=JSON.stringify(payload);
 const {calls,post}=setup('stripe-webhook',payload);
 assert.equal((await post()).status,200);
 const saved=calls.find(c=>c.table==='cell_links' && c.method==='insert').args[0];
 assert.equal(saved.length,2);
 assert.equal(saved[0].link_url,'https://example.com/');
 assert.equal(saved[1].link_url,'https://bit.ly/abc?q=1#part');
 assert.equal(saved[1].sort_order,2);
 for(const link of saved) assert.equal(links.postLinkHref(link.link_url),link.link_url);
 assert.equal(calls.find(c=>c.table==='cell_images' && c.method==='insert').args[0][0].image_url,'image-unchanged');
 assert.equal(JSON.stringify(payload),before);
 const validLegacy=setup('stripe-webhook',{...base,link_url:'example.com',links:[{link_url:'file:///bad'}]});
 assert.equal((await validLegacy.post()).status,200);
 assert.equal(validLegacy.calls.find(c=>c.table==='cells' && c.method==='insert').args[0][0].link_url,'https://example.com/');
});
test('webhook retains signature, payment and duplicate processing guards for invalid legacy orders', async () => {
 for(const options of [{badSignature:true},{paymentStatus:'unpaid'},{orderStatus:'paid'},{orderStatus:'cell_taken_refunded'}]) {
  const {calls,post}=setup('stripe-webhook',{...base,link_url:'javascript:alert(1)'},options);
  const result=await post();
  assert.equal(result.status,options.badSignature ? 400 : 200);
  assert.equal(calls.some(c=>['insert','delete','update'].includes(c.method) || c.refund),false);
  if(options.orderStatus) assert.equal(result.data.alreadyProcessed,true);
  else assert.equal(calls.length,0);
 }
});
test('webhook keeps cell-taken refund flow and idempotency key with invalid links', async () => {
 const {calls,post}=setup('stripe-webhook',{...base,link_url:'javascript:alert(1)'},{existingCell:{id:'taken'}});
 assert.equal((await post()).data.refunded,true);
 assert.equal(calls.some(c=>c.method==='insert'),false);
 assert.equal(calls.find(c=>c.refund).refund[1].idempotencyKey,'appicel-cell-taken-refund-order');
 assert.equal(calls.find(c=>c.table==='pending_cell_orders' && c.method==='update').args[0].status,'cell_taken_refunded');
});
test('webhook normalizes accepted links on save', async () => {
 const {calls,post}=setup('stripe-webhook',{...base,link_url:'example.com',links:[{link_url:'日本語.jp'}],images:[]});
 assert.equal((await post()).status,200);
 assert.equal(calls.find(c=>c.table==='cells' && c.method==='insert').args[0][0].link_url,'https://example.com/');
 assert.equal(calls.find(c=>c.table==='cell_links' && c.method==='insert').args[0][0].link_url,new URL('https://日本語.jp').href);
});
