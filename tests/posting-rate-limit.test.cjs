const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');

// Run real handlers + shared limiter, with no .env loading, network, DB or Storage.
const compiled = new Map();
const scopes = ['create-cell', 'create-checkout-session', 'upload-cell-image'];
const valid = {
  title: 'test', viewerId: 'viewer', planId: 'normal_free_1d',
  links: [{ link_type: 'other', link_url: 'example.com' }],
  images: [{ image_url: 'image', original_image_url: 'original' }],
};
function setup(options = {}) {
  const env = {
    NODE_ENV: 'production', VERCEL: '1', NEXT_PUBLIC_SUPABASE_URL: 'https://db.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', STRIPE_SECRET_KEY: 'test-stripe-key',
    NEXT_PUBLIC_SITE_URL: 'https://app.invalid', ...options.env,
  };
  const state = { events: [], rpc: [], writes: [], uploads: [], sessions: [] };
  const database = options.database || { now: 1000000, attempts: new Map() };
  const admin = {
    rpc: async (name, args) => {
      state.events.push('limit'); state.rpc.push({ name, args });
      if (options.rpcThrows) throw Error('private RPC secret');
      if ('rpcResult' in options) return options.rpcResult;
      if (options.limited) return { data: { allowed: false, retry_after: 123 }, error: null };
      if (options.modelLimit) {
        const key = `${args.p_scope}:${args.p_ip_hash}`;
        const attempts = (database.attempts.get(key) || []).filter(t => t > database.now - 600000);
        const max = args.p_scope === 'upload-cell-image' ? 60 : 10;
        if (attempts.length >= max) return { data: { allowed: false,
          retry_after: Math.ceil((attempts[0] + 600000 - database.now) / 1000) }, error: null };
        attempts.push(database.now); database.attempts.set(key, attempts);
      }
      return { data: { allowed: true, retry_after: 0 }, error: null };
    },
    from: table => {
      state.events.push(`db:${table}`);
      const query = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'gt', 'lt', 'delete', 'insert', 'update']) {
        query[method] = (...args) => {
          if (['insert', 'update', 'delete'].includes(method)) state.writes.push({ table, method, args });
          if (method === 'in') state.legacyHashes = args[1];
          return query;
        };
      }
      const error = options.dbError ? { message: 'private DB secret' } : null;
      query.single = async () => ({ data: { id: 'created' }, error });
      query.maybeSingle = async () => ({ data: options.cellTaken ? { id: 'taken' } : null, error });
      query.then = resolve => resolve({ data: null, error, count: options.dailyCount || 0 });
      return query;
    },
    storage: { from: () => ({
      upload: async (...args) => {
        state.events.push('storage'); state.uploads.push(args);
        return { error: options.storageError ? { message: 'private Storage secret' } : null };
      },
      getPublicUrl: () => ({ data: { publicUrl: 'https://images.invalid/image.png' } }),
    }) },
  };
  class Stripe {
    constructor() {
      this.checkout = { sessions: { create: async value => {
        state.events.push('stripe'); state.sessions.push(value);
        if (options.stripeThrows) throw Error('private Stripe secret');
        return { id: 'session', url: 'https://checkout.invalid/session' };
      } } };
    }
  }
  const mocks = {
    '@supabase/supabase-js': { createClient: () => admin },
    'next/server': { NextResponse: { json: (data, init) => ({ data, status: init?.status || 200, headers: init?.headers }) } },
    stripe: Stripe,
    sharp: () => { state.events.push('sharp'); return { metadata: async () => {
      if (options.badImage) throw Error('private Sharp secret');
      return { format: 'png', width: 2, height: 2 };
    } }; },
  };
  const modules = new Map();
  function load(filename) {
    filename = path.normalize(filename);
    if (modules.has(filename)) return modules.get(filename);
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText);
    const exports = {}; modules.set(filename, exports);
    vm.runInNewContext(compiled.get(filename), {
      exports, URL, Buffer, File, process: { env },
      console: { error: () => { throw Error('Unexpected logging'); } },
      require: name => name in mocks ? mocks[name]
        : name.startsWith('.') ? load(path.join(path.dirname(filename), `${name}.ts`)) : require(name),
    });
    return exports;
  }
  const post = (scope, body, headers = {}) => load(`app/api/${scope}/route.ts`).POST({
    url: 'https://app.invalid/api',
    headers: new Headers({ origin: 'https://app.invalid', 'x-vercel-forwarded-for': '203.0.113.1', ...headers }),
    json: async () => body === undefined ? { ...valid, planId: scope === 'create-cell' ? 'normal_free_1d' : 'premium_1d' } : body,
    formData: async () => {
      state.events.push('form-data');
      return { get: () => options.noFile ? null : new File(['fake-image'], 'test.png', { type: 'image/png' }) };
    },
  });
  return { state, post, database };
}
function noWork(state) {
  assert.equal(state.writes.length, 0);
  assert.equal(state.uploads.length, 0);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.events.some(e => e !== 'limit'), false);
}

for (const scope of scopes) {
  test(`${scope}: 429 uses DB Retry-After and prevents every heavy/DB/Stripe effect`, async () => {
    const { post, state } = setup({ limited: true });
    const response = await post(scope);
    assert.equal(response.status, 429); assert.equal(response.headers['Retry-After'], '123');
    assert.match(response.data.error, /123秒/);
    assert.equal(state.rpc[0].name, 'consume_posting_attempt');
    assert.equal(state.rpc[0].args.p_scope, scope); noWork(state);
  });
  test(`${scope}: limiter errors/exceptions/malformed output fail closed and hide private details`, async () => {
    for (const options of [
      { rpcThrows: true }, { rpcResult: { data: null, error: { message: 'private RPC secret' } } },
      ...[null, [], 'allowed', {}, { allowed: true, retry_after: 1 }, { allowed: false, retry_after: 0 },
        { allowed: false, retry_after: 601 }, { allowed: false, retry_after: 1.5 },
        { allowed: false, retry_after: '20' }].map(data => ({ rpcResult: { data, error: null } })),
    ]) {
      const { post, state } = setup(options);
      const response = await post(scope);
      assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(response), /secret|RPC|SUPABASE/);
      noWork(state);
    }
  });
  test(`${scope}: missing config/IP or spoofed untrusted headers never consume or perform work`, async () => {
    for (const env of [{ NEXT_PUBLIC_SUPABASE_URL: '' }, { SUPABASE_SERVICE_ROLE_KEY: '' },
      { VERCEL: '', POSTING_TRUSTED_IP_HEADER: '' }]) {
      const { post, state } = setup({ env });
      assert.equal((await post(scope)).status, 503); noWork(state); assert.equal(state.rpc.length, 0);
    }
    for (const ip of ['', 'unknown', '127.0.0.1:42', 'not-an-ip']) {
      const { post, state } = setup({ env: { POSTING_TRUSTED_IP_HEADER: 'x-spoofed' } });
      assert.equal((await post(scope, undefined, { 'x-vercel-forwarded-for': ip, 'x-spoofed': '203.0.113.9', 'x-forwarded-for': '203.0.113.9' })).status, 503);
      noWork(state); assert.equal(state.rpc.length, 0);
    }
  });
  test(`${scope}: normal operation consumes exactly one independent scope before effects`, async () => {
    const { post, state } = setup();
    assert.equal((await post(scope)).status, 200);
    assert.equal(state.rpc.length, 1); assert.equal(state.events[0], 'limit');
    assert.match(state.rpc[0].args.p_ip_hash, /^[0-9a-f]{64}$/);
    if (scope === 'upload-cell-image') {
      assert.equal(state.uploads.length, 1); assert.equal(state.sessions.length, 0);
      assert.ok(state.events.indexOf('sharp') > state.events.indexOf('limit'));
    } else if (scope === 'create-cell') {
      const cell = state.writes.find(w => w.table === 'cells').args[0][0];
      assert.equal(cell.link_url, 'https://example.com/');
      const log = state.writes.find(w => w.table === 'free_cell_posts').args[0][0];
      assert.equal(log.ip_hash, state.rpc[0].args.p_ip_hash);
      assert.equal(state.legacyHashes.includes(crypto.createHash('sha256').update('203.0.113.1').digest('hex')), true);
    } else {
      assert.equal(state.sessions.length, 1);
      const order = state.writes.find(w => w.table === 'pending_cell_orders' && w.method === 'insert').args[0][0];
      assert.equal(order.cell_payload.is_premium, true); assert.equal(order.cell_payload.comments_enabled, true);
    }
  });
}

test('IP HMAC canonicalizes IPv6/mapped IPv4, ignores spoofed headers and is keyed', async () => {
  const { post, state } = setup({ env: { POSTING_TRUSTED_IP_HEADER: 'x-spoofed' } });
  for (const ip of ['203.0.113.1', '::ffff:203.0.113.1', '::ffff:cb00:7101', '2001:db8::1', '2001:0db8:0:0:0:0:0:1', '203.0.113.2']) {
    assert.equal((await post('create-checkout-session', undefined, { 'x-vercel-forwarded-for': ip, 'x-spoofed': '1.2.3.4' })).status, 200);
  }
  const hashes = state.rpc.map(c => c.args.p_ip_hash);
  assert.equal(hashes[0], hashes[1]); assert.equal(hashes[0], hashes[2]);
  assert.equal(hashes[3], hashes[4]); assert.notEqual(hashes[0], hashes[5]);
  const other = setup({ env: { POSTING_IP_HASH_SECRET: 'different-key' } });
  await other.post('create-checkout-session'); assert.notEqual(hashes[0], other.state.rpc[0].args.p_ip_hash);
  assert.doesNotMatch(JSON.stringify(state.rpc), /203\.0\.113|2001:|test-service-key/);
});
test('non-Vercel trusts only configured ingress; development fallback never applies to Vercel', async () => {
  const configured = setup({ env: { VERCEL: '', POSTING_TRUSTED_IP_HEADER: 'x-ingress' } });
  assert.equal((await configured.post('upload-cell-image', undefined, { 'x-ingress': '203.0.113.9' })).status, 200);
  const dev = setup({ env: { VERCEL: '', NODE_ENV: 'development' } });
  assert.equal((await dev.post('upload-cell-image')).status, 200);
  const vercelDev = setup({ env: { NODE_ENV: 'development' } });
  assert.equal((await vercelDev.post('upload-cell-image', undefined, { 'x-vercel-forwarded-for': '' })).status, 503);
});
test('input validation before reservation costs no attempt; invalid files after reservation do', async () => {
  for (const scope of ['create-cell', 'create-checkout-session']) {
    const { post, state } = setup();
    assert.equal((await post(scope, { ...valid, planId: scope === 'create-cell' ? 'normal_free_1d' : 'premium_1d', links: [{ link_url: 'javascript:bad' }] })).status, 400);
    assert.equal(state.rpc.length, 0); noWork(state);
  }
  const badOrigin = setup();
  assert.equal((await badOrigin.post('upload-cell-image', undefined, { origin: 'https://bad.invalid' })).status, 403);
  assert.equal(badOrigin.state.rpc.length, 0);
  for (const options of [{ noFile: true }, { badImage: true }]) {
    const { post, state } = setup(options);
    assert.equal((await post('upload-cell-image')).status, 400); assert.equal(state.rpc.length, 1);
    assert.equal(state.uploads.length, 0);
  }
});
test('downstream failures consume attempts, remain sanitized, and do not retry automatically', async () => {
  for (const [scope, options] of [['create-cell', { dbError: true }], ['create-checkout-session', { dbError: true }],
    ['create-checkout-session', { stripeThrows: true }], ['upload-cell-image', { storageError: true }]]) {
    const { post, state } = setup(options);
    const result = await post(scope);
    assert.equal(result.status, 503); assert.doesNotMatch(JSON.stringify(result), /private|secret/);
    assert.equal(state.rpc.length, 1); assert.ok(state.sessions.length <= 1); assert.ok(state.uploads.length <= 1);
  }
  const daily = setup({ dailyCount: 3 });
  assert.equal((await daily.post('create-cell')).status, 429);
  assert.equal(daily.state.rpc.length, 1); assert.equal(daily.state.writes.length, 0);
});
test('shared DB mock demonstrates API/IP isolation across handlers and retry expiry without extension', async () => {
  // This checks the real handler/RPC contract, not real PostgreSQL locking.
  const first = setup({ modelLimit: true });
  const second = setup({ modelLimit: true, database: first.database });
  for (let i = 0; i < 10; i++) assert.equal((await (i % 2 ? first : second).post('create-checkout-session')).status, 200);
  first.database.now += 100000;
  assert.equal((await second.post('create-checkout-session')).headers['Retry-After'], '500');
  assert.equal((await first.post('create-cell')).status, 200);
  assert.equal((await first.post('create-checkout-session', undefined, { 'x-vercel-forwarded-for': '203.0.113.2' })).status, 200);
  for (let i = 0; i < 60; i++) assert.equal((await second.post('upload-cell-image')).status, 200);
  assert.equal((await first.post('upload-cell-image')).status, 429);
  first.database.now += 499999;
  assert.equal((await second.post('create-checkout-session')).headers['Retry-After'], '1');
  first.database.now += 1;
  assert.equal((await first.post('create-checkout-session')).status, 200);
});
