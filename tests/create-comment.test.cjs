const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

// Exercise the real route with a fake database and no .env loading/network calls.
const code = ts.transpileModule(
  fs.readFileSync("app/api/create-comment/route.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText;
const valid = {
  cellId: "123", viewerId: "12345678-1234-4234-8234-123456789abc",
  author: "", body: "hello",
};
function setup(overrides = {}) {
  const env = {
    NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-secret", COMMENT_TRUSTED_IP_HEADER: "x-test-ip",
    ...overrides,
  };
  const state = { calls: [], result: { data: "created", error: null } };
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, process: { env },
    require: (name) => {
      if (name === "@supabase/supabase-js") return {
        createClient: () => ({ rpc: async (name, args) => {
          state.calls.push({ name, args });
          if (state.throws) throw Error("private failure");
          return state.result;
        } }),
      };
      if (name === "next/server") return {
        NextResponse: { json: (data, options) => ({ data, status: options?.status || 200, headers: options?.headers }) },
      };
      return require(name);
    },
  });
  const post = (input = valid, ip = "203.0.113.1") => exports.POST({
    json: async () => input,
    headers: new Headers(ip ? { "x-test-ip": ip } : {}),
  });
  return { state, post, route: exports.POST };
}

test("invalid JSON, types, identifiers, lengths, blank text and NUL never reach DB", async () => {
  const { post, state, route } = setup();
  assert.equal((await route({ json: async () => { throw Error(); } })).status, 400);
  for (const input of [null, [], 12, { ...valid, cellId: "' OR true" },
    { ...valid, viewerId: "bad" }, { ...valid, author: 1 }, { ...valid, body: {} },
    { ...valid, author: "a".repeat(11) }, { ...valid, body: "a".repeat(151) },
    { ...valid, body: " \n\t　" }, { ...valid, body: "a\0" }]) {
    assert.equal((await post(input)).status, 400);
  }
  assert.equal(state.calls.length, 0);
});

test("boundary lengths, anonymous author, trimming and UUID canonicalization", async () => {
  const { post, state } = setup();
  assert.equal((await post({ ...valid, author: "a".repeat(10), body: "b".repeat(150) })).status, 201);
  assert.equal((await post({ ...valid, body: " hello ", viewerId: valid.viewerId.toUpperCase() })).status, 201);
  assert.equal(state.calls[1].name, "create_cell_comment");
  assert.equal(state.calls[1].args.p_author, "名無し");
  assert.equal(state.calls[1].args.p_body, "hello");
  assert.equal(state.calls[1].args.p_viewer_id, valid.viewerId);
});

test("missing config or untrusted/missing/malformed IP fails closed", async () => {
  for (const overrides of [{ SUPABASE_SERVICE_ROLE_KEY: "" },
    { COMMENT_TRUSTED_IP_HEADER: "" }, { NEXT_PUBLIC_SUPABASE_URL: "" }]) {
    const { post, state } = setup(overrides);
    assert.equal((await post()).status, 503);
    assert.equal(state.calls.length, 0);
  }
  const { post, state } = setup();
  for (const ip of [null, "spoofed"]) assert.equal((await post(valid, ip)).status, 503);
  assert.equal(state.calls.length, 0);
});

test("IP hashes are keyed, stable, canonical and separate different IPs", async () => {
  const { post, state } = setup();
  for (const ip of ["203.0.113.1", "203.0.113.1", "203.0.113.2",
    "2001:db8::1", "2001:0db8:0:0:0:0:0:1", "::ffff:203.0.113.1"]) await post(valid, ip);
  const hashes = state.calls.map(c => c.args.p_ip_hash);
  hashes.forEach(h => assert.match(h, /^[a-f0-9]{64}$/));
  assert.equal(hashes[0], hashes[1]);
  assert.notEqual(hashes[0], hashes[2]);
  assert.equal(hashes[3], hashes[4]);
  assert.equal(hashes[0], hashes[5]);
  const other = setup({ COMMENT_IP_HASH_SECRET: "different-test-key" });
  await other.post();
  assert.notEqual(other.state.calls[0].args.p_ip_hash, hashes[0]);
});

test("DB business outcomes map to UI errors and retry header", async () => {
  const { post, state } = setup();
  for (const [data, status] of [["rate_limited", 429], ["not_found", 404],
    ["comments_disabled", 403], ["comment_limit", 409], [null, 503]]) {
    state.result = { data, error: null };
    const response = await post();
    assert.equal(response.status, status);
    assert.equal(typeof response.data.error, "string");
    if (status === 429) assert.equal(response.headers["Retry-After"], "30");
  }
  state.result = { data: null, error: { message: "private database detail" } };
  assert.equal((await post()).status, 503);
  assert.doesNotMatch(JSON.stringify(await post()), /private database detail/);
  state.throws = true;
  assert.equal((await post()).status, 503);
});
