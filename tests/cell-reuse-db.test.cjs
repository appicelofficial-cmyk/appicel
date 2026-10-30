const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
let PGlite;
try { ({ PGlite } = require('../node_modules/.cache/cell-cleanup-db-test/node_modules/@electric-sql/pglite')); } catch {}

if (!PGlite) {
  test('isolated cell reuse PostgreSQL tests (optional PGlite required)',{skip:true},()=>{});
} else {
  let db;
  before(async()=>{
    db=new PGlite(); // Memory only; no env files, network, real payments or SQL migrations.
    await db.exec(`
      create role service_role bypassrls;
      create table cells (
        id uuid primary key default gen_random_uuid(), x integer, y integer,
        title text,author text,description text,link_type text,link_url text,
        image_url text,original_image_url text,expires_at timestamp without time zone,
        has_delete_password boolean,plan_id text,is_premium boolean,price_yen integer,
        rental_days integer,viewer_id text,comments_enabled boolean,unique(x,y));
      create table cell_images(cell_id uuid references cells(id) on delete cascade,
        image_url text,original_image_url text,sort_order integer);
      create table cell_links(cell_id uuid references cells(id) on delete cascade,
        link_type text,link_url text,sort_order integer);
      create table cell_delete_passwords(cell_id uuid references cells(id) on delete cascade,
        password_hash text,salt text);
      create table free_cell_posts(id uuid default gen_random_uuid(),viewer_id text,ip_hash text,
        cell_id uuid references cells(id) on delete cascade,
        created_at timestamp without time zone default (now() at time zone 'UTC'));
      create table pending_cell_orders(id uuid primary key default gen_random_uuid(),plan_id text,
        status text,cell_payload jsonb,password_hash text,password_salt text,stripe_session_id text,
        stripe_payment_intent text,refund_id text,refund_status text,error_message text);
      create table cleanup_blocker(cell_id uuid references cells(id));
      alter table cells enable row level security;
      grant select,insert,update,delete on all tables in schema public to service_role;
      set role service_role;
    `);
  });
  after(async()=>{await db?.close();});
  beforeEach(async()=>{
    await db.exec('reset role; truncate cells cascade; truncate pending_cell_orders; set role service_role');
  });
  const now=Date.parse('2026-10-30T12:00:00Z');
  class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
  const body={x:0,y:0,title:'synthetic',viewerId:'synthetic-viewer',planId:'normal_free_1d',
    links:[],images:[{image_url:'synthetic.png',original_image_url:'synthetic-original.png'}]};
  const payload={x:0,y:0,title:'synthetic paid',rental_days:1,plan_id:'normal_1d',price_yen:100,
    images:[{image_url:'synthetic.png',sort_order:0}],links:[],viewer_id:'synthetic-viewer'};
  const quote=name=>{assert.match(name,/^[a-z_]+$/);return `"${name}"`;};

  function handler(name) {
    const state={queries:[],sessions:[],refunds:[],rpc:[]};
    const admin={rpc:async(name,args)=>{state.rpc.push({name,args});return {data:{allowed:true,retry_after:0},error:null};},
      from:table=>{
        let operation='select', values, single=false, maybe=false, exact=false;
        const filters=[];
        const q={};
        q.select=(_columns,options)=>{exact=options?.count==='exact';return q;};
        q.insert=value=>{operation='insert';values=Array.isArray(value)?value:[value];return q;};
        q.update=value=>{operation='update';values=value;return q;};
        q.delete=()=>{operation='delete';return q;};
        for(const [method,operator] of Object.entries({eq:'=',gt:'>',gte:'>=',lte:'<=',lt:'<',in:'in'}))
          q[method]=(column,value)=>{filters.push({column,operator,value});return q;};
        q.single=()=>{single=true;return execute();};
        q.maybeSingle=()=>{maybe=true;return execute();};
        q.then=(resolve,reject)=>execute().then(resolve,reject);
        async function execute() {
          const args=[];
          const bind=value=>{args.push(value && typeof value==='object' && !Array.isArray(value)?JSON.stringify(value):value);return `$${args.length}`;};
          const where=filters.length?' where '+filters.map(f=>f.operator==='in'
            ? `${quote(f.column)}=any(${bind(f.value)}::text[])`
            : `${quote(f.column)}${f.operator}${bind(f.value)}`).join(' and '):'';
          let sql;
          if(operation==='delete')sql=`delete from ${quote(table)}${where} returning *`;
          else if(operation==='insert') {
            const keys=Object.keys(values[0]);
            sql=`insert into ${quote(table)}(${keys.map(quote).join(',')}) values `+
              values.map(row=>`(${keys.map(key=>bind(row[key])).join(',')})`).join(',')+' returning *';
          } else if(operation==='update') {
            const set=Object.entries(values).map(([key,value])=>`${quote(key)}=${bind(value)}`).join(',');
            sql=`update ${quote(table)} set ${set}${where} returning *`;
          } else sql=`select ${exact?'count(*)::integer as count':'*'} from ${quote(table)}${where}`;
          state.queries.push({table,operation,filters});
          try {
            const {rows}=await db.query(sql,args);
            if(single && rows.length!==1)throw Error('Expected one synthetic row');
            return {data:single||maybe?rows[0]||null:rows,error:null,count:exact?rows[0].count:null};
          } catch(error) {return {data:null,error:{message:error.message},count:null};}
        }
        return q;
      }};
    class Stripe {
      constructor(){
        this.checkout={sessions:{create:async value=>{state.sessions.push(value);return {id:'cs_test_synthetic',url:'https://checkout.invalid'};}}};
        this.webhooks={constructEvent:()=>({type:'checkout.session.completed',data:{object:{id:'cs_test_synthetic',payment_status:'paid',payment_intent:'pi_test_synthetic'}}})};
        this.refunds={create:async()=>{state.refunds.push(true);return {id:'re_test_synthetic',status:'succeeded'};}};
      }
    }
    const env={NODE_ENV:'production',VERCEL:'1',NEXT_PUBLIC_SUPABASE_URL:'https://db.invalid',
      SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role',STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'synthetic'};
    const mocks={'next/server':{NextResponse:{json:(data,options)=>({data,status:options?.status||200})}},
      '@supabase/supabase-js':{createClient:(_url,key)=>{assert.equal(key,'synthetic-service-role');return admin;}},stripe:Stripe};
    const modules=new Map();
    function load(file) {
      file=path.normalize(file);if(modules.has(file))return modules.get(file);
      const exports={};modules.set(file,exports);
      const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
      vm.runInNewContext(code,{exports,Date:Clock,URL,Buffer,process:{env},require:module=>module in mocks?mocks[module]:
        module.startsWith('.')?load(path.join(path.dirname(file),`${module}.ts`)):require(module)});
      return exports;
    }
    const route=load(`app/api/${name}/route.ts`);
    return {state,post:(overrides={})=>route.POST({url:'https://app.invalid/api',
      headers:new Headers({'x-vercel-forwarded-for':'203.0.113.1','stripe-signature':'synthetic'}),
      json:async()=>({...body,...overrides}),text:async()=>''})};
  }
  const seed=async(active=false)=>{
    const row=(await db.query(`insert into cells(x,y,title,expires_at) values
      (0,0,'old',$1) returning id`,[active?'2026-10-30T12:10:00':'2026-10-30T12:00:00'])).rows[0];
    await db.exec("insert into cells(x,y,title,expires_at) values(2,2,'untouched expired','2026-10-29T12:00:00')");
    await db.query("insert into cell_images(cell_id,image_url) values($1,'old synthetic image')",[row.id]);
    return row.id;
  };
  const order=()=>db.query("insert into pending_cell_orders(status,stripe_session_id,cell_payload) values('pending','cs_test_synthetic',$1)",[JSON.stringify(payload)]);

  for(const zone of ['UTC','Asia/Tokyo','America/New_York']) {
    test(`free post reuses expired UUID coordinate under ${zone}, keeping unrelated expired rows`,async()=>{
      await db.query("select set_config('TimeZone',$1,false)",[zone]);
      const old=await seed();
      const h=handler('create-cell');assert.equal((await h.post()).status,200);
      const rows=(await db.query('select id,title from cells order by x')).rows;
      assert.equal(rows.length,2);assert.notEqual(rows[0].id,old);assert.equal(rows[0].title,'synthetic');
      assert.equal(rows[1].title,'untouched expired');
      assert.equal((await db.query('select count(*)::integer as n from cell_images where cell_id=$1',[old])).rows[0].n,0);
      assert.equal((await db.query('select count(*)::integer as n from free_cell_posts')).rows[0].n,1);
      assert.equal(h.state.rpc.length,1);assert.equal(h.state.rpc[0].name,'consume_posting_attempt');
    });
    test(`paid start and signed completion reuse expired coordinate under ${zone}`,async()=>{
      await db.query("select set_config('TimeZone',$1,false)",[zone]);
      const old=await seed();
      const start=handler('create-checkout-session');assert.equal((await start.post({planId:'normal_1d'})).status,200);
      assert.equal(start.state.sessions.length,1);
      // Another expired row can remain until payment arrives; finalization must
      // perform its own cleanup even if checkout start previously succeeded.
      await db.query("insert into cells(x,y,title,expires_at) values(0,0,'expired while paying','2026-10-30T11:00:00')");
      const finish=handler('stripe-webhook');assert.equal((await finish.post()).status,200);
      assert.equal(finish.state.refunds.length,0);
      const rows=(await db.query('select id,title from cells order by x')).rows;
      assert.equal(rows.length,2);assert.notEqual(rows[0].id,old);assert.equal(rows[0].title,'synthetic');
      assert.equal(rows[1].title,'untouched expired');
      assert.equal((await db.query('select status from pending_cell_orders')).rows[0].status,'paid');
    });
  }
  test('active cells survive free/paid attempts; paid completion retains existing refund path',async()=>{
    const id=await seed(true);
    assert.equal((await handler('create-cell').post()).status,409);
    const start=handler('create-checkout-session');assert.equal((await start.post({planId:'normal_1d'})).status,409);
    assert.equal(start.state.sessions.length,0);
    await order();const finish=handler('stripe-webhook');assert.equal((await finish.post()).status,200);
    assert.equal(finish.state.refunds.length,1);
    assert.equal((await db.query('select title from cells where id=$1',[id])).rows[0].title,'old');
  });
  for(const name of ['create-cell','create-checkout-session','stripe-webhook']) {
    test(`${name}: FK cleanup failure returns 503 before inserting or charging/refunding`,async()=>{
      const id=await seed();await db.query('insert into cleanup_blocker values($1)',[id]);
      if(name==='stripe-webhook')await order();
      const h=handler(name);assert.equal((await h.post({planId:name==='create-cell'?'normal_free_1d':'normal_1d'})).status,503);
      assert.equal(h.state.queries.some(q=>q.operation==='insert'),false);
      assert.equal(h.state.sessions.length,0);assert.equal(h.state.refunds.length,0);
      assert.equal((await db.query('select title from cells where id=$1',[id])).rows[0].title,'old');
    });
  }
  test('invalid coordinates never clean cells or consume a start attempt',async()=>{
    for(const name of ['create-cell','create-checkout-session'])for(const x of [-1,32,0.5,'0',null]) {
      const h=handler(name);assert.equal((await h.post({x,planId:name==='create-cell'?'normal_free_1d':'normal_1d'})).status,400);
      assert.equal(h.state.queries.length,0);assert.equal(h.state.rpc.length,0);
    }
  });
}
