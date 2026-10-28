const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");

// No .env loading, real Supabase clients, network calls, or real deletions.
const code = ts.transpileModule(fs.readFileSync("app/api/admin-delete-cell/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const valid = { cellId: 123, adminKey: "test-admin-password" };
function setup(overrides = {}) {
  const env = {
    NODE_ENV: "production", VERCEL: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key", ADMIN_DELETE_KEY: valid.adminKey,
    ...overrides,
  };
  const state = {
    events: [], calls: [], deletes: [], comparisons: [],
    result: { data: { allowed: true, retry_after: 0 }, error: null },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, process: { env },
    require: name => {
      if (name === "node:crypto") return {
        ...crypto,
        timingSafeEqual: (a, b) => {
          state.events.push("compare"); state.comparisons.push([a.length, b.length]);
          return crypto.timingSafeEqual(a, b);
        },
      };
      if (name === "next/server") return {
        NextResponse: { json: (body, options) => ({ body, status: options?.status || 200, headers: options?.headers }) },
      };
      if (name === "@supabase/supabase-js") return {
        createClient: () => ({
          rpc: async (name, args) => {
            state.events.push("limit"); state.calls.push({ name, args });
            if (state.rpcThrows) throw Error("private RPC details");
            return state.result;
          },
          from: table => ({ delete: () => ({ eq: async (column, value) => {
            state.events.push("delete"); state.deletes.push({ table, column, value });
            if (state.deleteThrows) throw Error("private delete details");
            return { error: state.deleteError || null };
          } }) }),
        }),
      };
      return require(name);
    },
  });
  const post = (input = valid, headers = { "x-vercel-forwarded-for": "203.0.113.1" }) =>
    exports.POST({ json: async () => input, headers: new Headers(headers) });
  return { state, post, route: exports.POST };
}

test("invalid JSON, input types, blank/oversized keys and invalid IDs never authenticate or delete", async () => {
  const { route, post, state } = setup();
  assert.equal((await route({ json: async () => { throw Error(); } })).status, 400);
  for (const input of [null, [], "bad", {}, { ...valid, adminKey: 1 },
    { ...valid, adminKey: " \t　" }, { ...valid, adminKey: "x".repeat(1025) },
    { ...valid, adminKey: "x\0" }, ...[null, {}, [], true, 0, -1, 1.2, 1e20,
      "", " ", "0", "123 OR true", "x".repeat(129)].map(cellId => ({ ...valid, cellId }))]) {
    assert.equal((await post(input)).status, 400);
  }
  assert.deepEqual(state.events, []);
});

test("valid numeric/UUID IDs delete only after limit check and constant-length comparison", async () => {
  const { post, state } = setup();
  for (const cellId of [123, "123", "12345678-1234-4234-8234-123456789abc"]) {
    assert.equal((await post({ ...valid, cellId })).status, 200);
  }
  assert.deepEqual(state.events, Array(3).fill(["limit", "compare", "delete"]).flat());
  state.comparisons.forEach(lengths => assert.deepEqual(lengths, [32, 32]));
  assert.deepEqual(state.deletes.map(d => d.value), [123, "123", "12345678-1234-4234-8234-123456789abc"]);
  assert.ok(state.deletes.every(d => d.table === "cells" && d.column === "id"));
});

test("wrong passwords consume attempts, use fixed-length comparison, and never delete", async () => {
  const { post, state } = setup();
  for (const adminKey of ["wrong", "x".repeat(1024), " test-admin-password "]) {
    assert.equal((await post({ ...valid, adminKey })).status, 401);
  }
  assert.equal(state.calls.length, 3);
  assert.equal(state.deletes.length, 0);
  state.comparisons.forEach(lengths => assert.deepEqual(lengths, [32, 32]));
});

test("429 prevents even correct authentication and returns DB-derived Retry-After", async () => {
  const { post, state } = setup();
  state.result = { data: { allowed: false, retry_after: 642 }, error: null };
  const response = await post();
  assert.equal(response.status, 429);
  assert.equal(response.headers["Retry-After"], "642");
  assert.match(response.body.error, /642/);
  assert.deepEqual(state.events, ["limit"]);
});

test("RPC errors, exceptions and malformed results fail closed before password comparison", async () => {
  const { post, state } = setup();
  for (const data of [null, [], true, {}, { allowed: "true", retry_after: 0 },
    { allowed: true }, { allowed: true, retry_after: 1 },
    { allowed: false, retry_after: 0 }, { allowed: false, retry_after: 901 }]) {
    state.result = { data, error: null };
    assert.equal((await post()).status, 503);
  }
  state.result = { data: { allowed: true, retry_after: 0 }, error: { message: "private DB details" } };
  assert.equal((await post()).status, 503);
  state.rpcThrows = true;
  assert.equal((await post()).status, 503);
  assert.equal(state.comparisons.length, 0);
  assert.equal(state.deletes.length, 0);
});

test("missing config and missing/malformed/untrusted IP fail closed", async () => {
  for (const name of ["ADMIN_DELETE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"]) {
    const { post, state } = setup({ [name]: "" });
    const response = await post();
    assert.equal(response.status, 503);
    assert.doesNotMatch(JSON.stringify(response), /ADMIN_DELETE_KEY|SUPABASE|test-service-key/);
    assert.deepEqual(state.events, []);
  }
  const { post, state } = setup();
  for (const headers of [{}, { "x-forwarded-for": "203.0.113.1" }, { "x-vercel-forwarded-for": "bad" }]) {
    assert.equal((await post(valid, headers)).status, 503);
  }
  assert.deepEqual(state.events, []);
  assert.equal((await setup({ VERCEL: "" }).post()).status, 503);
  assert.equal((await setup({ VERCEL: "", NODE_ENV: "development" }).post(valid, {})).status, 200);
});

test("hash is independent of cell ID/key, canonicalizes IP, and Vercel ignores custom overrides", async () => {
  const { post, state } = setup({ ADMIN_DELETE_TRUSTED_IP_HEADER: "attacker-ip" });
  for (const [ip, cellId] of [["203.0.113.1", 1], ["203.0.113.1", 2],
    ["::ffff:203.0.113.1", 3], ["2001:db8::1", 4], ["2001:0db8:0:0:0:0:0:1", 5],
    ["203.0.113.2", 6]]) {
    await post({ cellId, adminKey: "wrong" }, { "x-vercel-forwarded-for": ip, "attacker-ip": "192.0.2.1" });
  }
  const hashes = state.calls.map(c => c.args.p_ip_hash);
  hashes.forEach(h => assert.match(h, /^[a-f0-9]{64}$/));
  assert.equal(hashes[0], hashes[1]); assert.equal(hashes[0], hashes[2]);
  assert.equal(hashes[3], hashes[4]); assert.notEqual(hashes[0], hashes[5]);
  assert.ok(state.calls.every(c => c.name === "consume_admin_delete_attempt" && Object.keys(c.args).length === 1));
  const other = setup({ ADMIN_DELETE_IP_HASH_SECRET: "different-test-secret" });
  await other.post(); assert.notEqual(other.state.calls[0].args.p_ip_hash, hashes[0]);
});

test("delete errors are sanitized and never return success", async () => {
  const { post, state } = setup();
  state.deleteError = { message: "private DB details" };
  let response = await post();
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(response), /private DB details/);
  state.deleteThrows = true;
  response = await post(); assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(response), /private delete details/);
});
