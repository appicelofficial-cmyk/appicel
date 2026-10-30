const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');

const compile = code => ts.transpileModule(code, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const expiry = {};
vm.runInNewContext(compile(fs.readFileSync('lib/cell-expiry.ts','utf8')),{exports:expiry,Date});
const pageText = fs.readFileSync('app/page.tsx','utf8');
const ast = ts.createSourceFile('page.tsx',pageText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const stateNames=[];
function visit(node) {
  if(ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) &&
    ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast)==='useState')
    stateNames.push(node.name.elements[0].getText(ast));
  ts.forEachChild(node,visit);
}
visit(ast);
const now=Date.parse('2026-10-30T12:00:00Z');
const active={id:'active',x:1,y:1,title:'ACTIVE_TITLE',expires_at:'2026-10-30T12:00:01',image_url:'active.png'};
const expired={id:'expired',x:0,y:0,title:'EXPIRED_TITLE',expires_at:'2026-10-30T12:00:00',image_url:'expired.png'};

function render(overrides={}) {
  const changes={}, effects=[], timers=new Map(), listeners=new Map(), queries=[];
  const context={nowTime:now,cells:[expired,active],pvRanking:[{cell:expired,count:10},{cell:active,count:1}],...overrides};
  const react={
    useState:initial=>{
      const name=stateNames[react.index++];
      return [name in context?context[name]:typeof initial==='function'?initial():initial,
        value=>{changes[name]=value;}];
    }, index:0,
    useRef:value=>({current:value}),
    useEffect:callback=>effects.push(callback),
  };
  const browser={visibilityState:'visible',
    addEventListener:(event,callback)=>listeners.set(event,callback),
    removeEventListener:event=>listeners.delete(event)};
  const supabase={from:table=>{
    const query={};
    for(const method of ['select','gt','gte']) query[method]=(...args)=>{
      queries.push({table,method,args});return query;
    };
    // No delete/write methods: accidental browser mutations fail this harness.
    query.then=resolve=>resolve({data:[],error:null});
    return query;
  }};
  class Clock extends Date { static now(){return now;} }
  const exports={};
  vm.runInNewContext(compile(pageText),{
    exports,Date:Clock,console,
    window:browser,document:browser,
    setInterval:(callback,ms)=>{timers.set(ms,callback);return ms;},
    clearInterval:ms=>timers.delete(ms),
    setTimeout:()=>1,clearTimeout:()=>{},
    require:name=>{
      if(name==='react')return react;
      if(name==='react/jsx-runtime')return jsx;
      if(name==='../lib/cell-expiry')return expiry;
      if(name==='../lib/supabase')return {supabase};
      if(name==='../lib/post-links')return {};
      if(name.startsWith('react-icons/') || name==='react-easy-crop')return new Proxy({}, {get:()=>()=>null});
      throw Error(`Unexpected import: ${name}`);
    },
  });
  return {tree:exports.default(),changes,effects,timers,listeners,queries,browser};
}
function nodes(tree,out=[]) {
  if(Array.isArray(tree)){for(const child of tree)nodes(child,out);return out;}
  if(tree && typeof tree==='object' && tree.props){out.push(tree);nodes(tree.props.children,out);}
  return out;
}
const texts=tree=>JSON.stringify(nodes(tree).map(node=>node.props.children).filter(v=>typeof v==='string'));

test('UTC wall timestamps and explicit offsets expire at the same instant',()=>{
  for(const value of ['2026-10-30T12:00:00','2026-10-30T12:00:00Z','2026-10-30T21:00:00+09:00']) {
    assert.equal(expiry.cellExpiryTime(value),now);
    assert.equal(expiry.isActiveCell({expires_at:value},now),false);
    assert.equal(expiry.isActiveCell({expires_at:value},now-1),true);
  }
  for(const value of [null,undefined,'','invalid'])assert.equal(expiry.isActiveCell({expires_at:value},now),false);
});

test('full page excludes expired board images, details, notice and ranking without deleting DB rows',()=>{
  const result=render({selectedCell:expired,cellNotice:'EXPIRED_NOTICE',cellNoticeCell:expired});
  const all=nodes(result.tree);
  assert.equal(all.some(node=>node.type==='img' && node.props.src==='expired.png'),false);
  assert.equal(all.some(node=>node.type==='img' && node.props.src==='active.png'),true);
  assert.doesNotMatch(texts(result.tree),/EXPIRED_TITLE|EXPIRED_NOTICE/);
  assert.match(texts(result.tree),/ACTIVE_TITLE/);
  const close=result.effects.find(fn=>fn.toString().includes('setCommentBody'));
  close();assert.equal(result.changes.selectedCell,null);
  assert.deepEqual(Array.from(result.changes.comments),[]);
});

test('expiry tick closes active details, removes ranking and promotes the next item into TOP20',()=>{
  const live=render({selectedCell:active});
  assert.equal(nodes(live.tree).some(node=>node.props.className?.includes('fixed inset-0')),true);
  const ranking=Array.from({length:21},(_,index)=>({cell:{...active,id:`rank-${index}`,title:`RANK_${index}`},count:21-index}));
  ranking[0].cell=expired;
  const result=render({nowTime:now+1000,selectedCell:active,pvRanking:ranking.map((item,index)=>index===0?item:
    {...item,cell:{...item.cell,expires_at:'2026-10-31T00:00:00Z'}})});
  assert.equal(nodes(result.tree).some(node=>node.props.className?.includes('fixed inset-0')),false);
  assert.match(texts(result.tree),/RANK_20/);
  assert.doesNotMatch(texts(result.tree),/EXPIRED_TITLE/);
});

test('expired coordinate opens the create form even when an expired row remains in state',async()=>{
  const result=render();
  const clickTargets=nodes(result.tree).filter(node=>node.type==='div' && typeof node.props.onClick==='function');
  assert.equal(clickTargets.length,1024);
  await clickTargets[0].props.onClick();
  assert.deepEqual({...result.changes.createCell},{x:0,y:0});
});

test('clock makes no network calls; polling/focus use SELECT only and dispose all timers/listeners',async()=>{
  const result=render();
  assert.doesNotMatch(pageText,/deleteExpiredCells|\.delete\s*\(/);
  const start=result.effects.find(fn=>fn.toString().includes('refreshTimer'));
  const dispose=start();
  assert.deepEqual([...result.timers.keys()].sort((a,b)=>a-b),[1000,15000]);
  result.timers.get(1000)();assert.equal(result.queries.length,0);
  result.timers.get(15000)();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(result.queries.filter(q=>q.method==='select').length,2);
  assert.equal(result.queries.some(q=>q.table==='cells' && q.method==='gt' && q.args[0]==='expires_at'),true);
  result.browser.visibilityState='hidden';
  const before=result.queries.length;
  result.timers.get(15000)();assert.equal(result.queries.length,before);
  result.browser.visibilityState='visible';
  result.listeners.get('focus')();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(result.queries.filter(q=>q.method==='select').length,4);
  dispose();assert.equal(result.timers.size,0);assert.equal(result.listeners.size,0);
});
