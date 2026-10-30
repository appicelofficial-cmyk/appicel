const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real UI submit functions, extracted with the TypeScript AST.
// No React render, browser, uploads or payment connections are made.
const source = ts.createSourceFile('page.tsx', fs.readFileSync('app/page.tsx', 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ['uploadCellImage', 'saveCell'].includes(node.name?.text)) {
    functions.push(node.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(functions.length, 2);
const setters = ['setCreateCell', 'setTitle', 'setAuthor', 'setLinkType', 'setLinkUrl',
  'setDescription', 'setDeletePassword', 'setSelectedPlanId', 'setCommentsDisabled',
  'setImageFiles', 'setImagePreviews', 'setLinks', 'setCrop', 'setZoom', 'setCroppedAreaPixels'];
const dependencies = ['createCell', 'savingCellRef', 'setIsSavingCell', 'PLANS', 'selectedPlanId',
  'title', 'author', 'description', 'imageFiles', 'imagePreviews', 'croppedAreaPixels',
  'links', 'validatePostLinks', 'getCroppedImage', 'deletePassword', 'getViewerId',
  'commentsDisabled', 'fetch', 'alert', 'window', 'fetchCells', 'fetchPvRanking', ...setters];
const exportsUI = {};
vm.runInNewContext(ts.transpileModule(`export function createSubmitter(context: any) {
  const { ${dependencies.join(',')} } = context;
  ${functions.join('\n')}
  return saveCell;
}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
{ exports: exportsUI, FormData, console: { error: () => {} } });
const exportsLinks = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/post-links.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsLinks, URL });

function setup(planId, imageCount, failAt) {
  const state = { requests: [], messages: [], resets: [], busy: [] };
  const error = '回数が多くなっています。123秒後に再度お試しください。';
  const context = {
    createCell: { x: 1, y: 1 }, savingCellRef: { current: false },
    setIsSavingCell: value => state.busy.push(value),
    PLANS: { normal_free_1d: { descriptionMax: 200, imageMax: 2 }, premium_1d: { descriptionMax: 500, imageMax: 5 } },
    selectedPlanId: planId, title: '入力したタイトル', author: '投稿者', description: '説明',
    imageFiles: Array.from({ length: imageCount }, (_, i) => new File(['image'], `${i}.png`)),
    imagePreviews: Array(imageCount).fill('blob:preview'), croppedAreaPixels: {},
    links: [{ link_url: 'example.com', link_type: 'other' }],
    validatePostLinks: exportsLinks.validatePostLinks,
    getCroppedImage: async () => new Blob(['cropped']), deletePassword: 'password',
    getViewerId: () => 'viewer', commentsDisabled: false,
    fetch: async (url, init) => {
      state.requests.push({ url, init });
      const upload = url === '/api/upload-cell-image';
      const failed = failAt === 'upload' ? upload : failAt === 'submit' ? !upload : false;
      return { ok: !failed, status: failed ? 429 : 200, json: async () => failed
        ? { error } : upload ? { url: 'https://images.invalid/image.png' } : { url: 'https://checkout.invalid' } };
    },
    alert: message => state.messages.push(message), window: { location: { href: '' } },
    fetchCells: () => {}, fetchPvRanking: () => {},
  };
  for (const setter of setters) context[setter] = value => state.resets.push({ setter, value });
  return { save: exportsUI.createSubmitter(context), state, context, error };
}

test('UI: same-tick double submission sends one workflow; 429 keeps input and stops without retry', async () => {
  for (const [planId, count] of [['normal_free_1d', 2], ['premium_1d', 5]]) {
    const { save, state, context, error } = setup(planId, count, 'submit');
    await Promise.all([save(), save()]);
    assert.equal(state.requests.filter(r => r.url === '/api/upload-cell-image').length, count + 1);
    assert.equal(state.requests.filter(r => r.url !== '/api/upload-cell-image').length, 1);
    assert.equal(state.requests.at(-1).url, planId === 'normal_free_1d' ? '/api/create-cell' : '/api/create-checkout-session');
    assert.deepEqual(state.messages, [error]); assert.deepEqual(state.resets, []);
    assert.deepEqual(state.busy, [true, false]); assert.equal(context.savingCellRef.current, false);
    assert.equal(context.imageFiles.length, count); assert.equal(context.title, '入力したタイトル');
  }
});
test('UI: upload 429 stops later uploads and submission while preserving form', async () => {
  const { save, state, context, error } = setup('premium_1d', 5, 'upload');
  await Promise.all([save(), save()]);
  assert.equal(state.requests.length, 1); assert.deepEqual(state.messages, [error]);
  assert.deepEqual(state.resets, []); assert.equal(context.savingCellRef.current, false);
});
test('UI: paid success retains lock through navigation; free success resets form', async () => {
  const paid = setup('premium_1d', 5);
  await paid.save(); await paid.save();
  assert.equal(paid.state.requests.length, 7);
  assert.equal(paid.context.window.location.href, 'https://checkout.invalid');
  assert.equal(paid.context.savingCellRef.current, true); assert.deepEqual(paid.state.busy, [true]);
  const free = setup('normal_free_1d', 2);
  await free.save(); assert.equal(free.state.requests.length, 4);
  assert.equal(free.state.resets.some(r => r.setter === 'setTitle' && r.value === ''), true);
  assert.equal(free.context.savingCellRef.current, false);
});
