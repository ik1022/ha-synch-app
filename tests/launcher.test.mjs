import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateOptions, loadSecrets } from '../synch/launcher.mjs';

test('normalizes URL and email allowlist', () => {
  assert.deepEqual(validateOptions({ public_url:'https://synch.example.com/', allowed_emails:[' A@example.com ', 'a@example.com'] }),
    { publicUrl:'https://synch.example.com', emails:'a@example.com', timeout:300000 });
});
test('rejects malformed options', () => {
  const valid = { public_url:'http://192.168.1.2:8787', allowed_emails:['a@example.com'] };
  for (const public_url of ['', 'file:///tmp', 'https://user:pass@x', 'https://x/path', 'https://x?q=1']) {
    assert.throws(() => validateOptions({ ...valid, public_url }));
  }
  for (const allowed_emails of [[], [''], ['x@y,z@a'], 'a@example.com']) assert.throws(() => validateOptions({ ...valid, allowed_emails }));
  for (const request_timeout_ms of [0, 1500001, '3000']) assert.throws(() => validateOptions({ ...valid, request_timeout_ms }));
});
function temporary(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synch-unit-'));
  try { fn(root); } finally { fs.rmSync(root, { recursive:true, force:true }); }
}
test('independent secrets persist across restarts', () => temporary(root => {
  const first = loadSecrets(root);
  assert.notEqual(first.auth, first.sync);
  assert.deepEqual(loadSecrets(root), first);
}));
test('existing data cannot silently acquire replacement secrets', () => temporary(root => {
  fs.mkdirSync(path.join(root, 'synch'));
  fs.writeFileSync(path.join(root, 'synch/app.db'), 'existing');
  assert.throws(() => loadSecrets(root), /Existing data/);
  assert.equal(fs.existsSync(path.join(root, 'synch-secrets.json')), false);
}));
test('malformed keys are not overwritten', () => temporary(root => {
  fs.writeFileSync(path.join(root, 'synch-secrets.json'), '{}');
  assert.throws(() => loadSecrets(root));
  assert.equal(fs.readFileSync(path.join(root, 'synch-secrets.json'), 'utf8'), '{}');
}));
