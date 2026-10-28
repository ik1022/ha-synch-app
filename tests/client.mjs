import assert from 'node:assert/strict';
import fs from 'node:fs';
const mode = process.argv[2];
const origin = JSON.parse(fs.readFileSync('/data/options.json')).public_url;
const base = 'http://127.0.0.1:8787';
let cookie;
async function request(route, method='GET', data, headers={}) {
  const r = await fetch(base + route, { method, headers:{ Origin:origin, ...(cookie ? { Cookie:cookie } : {}),
    ...(data !== undefined ? {'Content-Type':'application/json'} : {}), ...headers },
    ...(data !== undefined ? {body:JSON.stringify(data)} : {}) });
  return r;
}
async function json(route, method='GET', data) {
  const r = await request(route, method, data);
  assert.ok(r.ok, `${method} ${route}: ${r.status}`);
  return r.json();
}
const wrapper = { kind:'password', envelope:{version:1,keyVersion:1,
  kdf:{name:'argon2id',memoryKiB:65536,iterations:3,parallelism:1,salt:'MDEyMzQ1Njc4OWFiY2RlZg=='},
  wrap:{algorithm:'aes-256-gcm',nonce:'AAECAwQFBgcICQoL',ciphertext:'c3luY2h2YXVsdC13cmFwcGVkLXZhdWx0LWtleS12MS10ZXN0LWNpcGhlcnRleHQh'}}};
// Synthetic opaque bytes: verifies transport/storage, not client-side encryption.
const payload = 'opaque-test-ciphertext';
let state;
if (mode === 'create') {
  const denied = await request('/api/auth/sign-up/email','POST',{email:'denied@example.com',password:'long-test-password-123',name:'Denied'});
  assert.equal(denied.status,403);
  const signup = await request('/api/auth/sign-up/email','POST',{email:'test@example.com',password:'long-test-password-123',name:'Test'});
  assert.ok(signup.ok, `signup: ${signup.status}`);
  cookie = signup.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
  assert.ok(cookie);
  state = { cookie, vaultId:(await json('/v1/vaults','POST',{name:'HA smoke vault',initialWrapper:wrapper})).vault.id };
} else {
  state = JSON.parse(fs.readFileSync('/data/test-state.json'));
  cookie = state.cookie;
  const session = await json('/api/auth/get-session');
  assert.equal(session.user.email,'test@example.com');
}

async function device(id) {
  const token = (await json('/v1/sync/token','POST',{vaultId:state.vaultId,localVaultId:id})).token;
  const ws = new WebSocket(`${base.replace('http:','ws:')}/v1/vaults/${state.vaultId}/socket`, ['synch.v1', `synch.auth.${token}`]);
  const inbox = [];
  ws.addEventListener('message', e => inbox.push(JSON.parse(e.data)));
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')),10000);
    ws.addEventListener('open', () => {clearTimeout(timer);resolve();},{once:true});
    ws.addEventListener('error', () => {clearTimeout(timer);reject(new Error('WebSocket error'));},{once:true});
  });
  async function receive(type) {
    const end = Date.now()+10000;
    while (Date.now()<end) {
      const i = inbox.findIndex(m => m.type===type);
      if (i>=0) return inbox.splice(i,1)[0];
      await new Promise(r => setTimeout(r,25));
    }
    throw new Error(`No ${type}; received ${inbox.map(m=>m.type).join(',')}`);
  }
  const send = data => ws.send(JSON.stringify(data));
  send({type:'hello',requestId:`hello-${id}`,lastKnownCursor:0});
  await receive('hello_ack');
  return {ws,token,send,receive};
}
const a = await device('device-a');
const b = await device('device-b');
try {
  if (mode === 'create') {
    const r = await fetch(`${base}/v1/vaults/${state.vaultId}/blobs/blob-1`,{method:'PUT',headers:{Authorization:`Bearer ${a.token}`,'x-blob-size':String(Buffer.byteLength(payload))},body:payload});
    assert.equal(r.status,201);
    a.send({type:'commit_mutations',requestId:'commit-1',mutations:[{mutationId:'mutation-1',entryId:'entry-1',op:'upsert',baseRevision:0,blobId:'blob-1',encryptedMetadata:'opaque-metadata'}]});
    const committed = await a.receive('commit_mutations_committed');
    assert.equal(committed.results[0].status,'accepted');
    await b.receive('cursor_advanced');
  }
  b.send({type:'list_entry_states',requestId:'list-1',sinceCursor:0,targetCursor:null,after:null,limit:10});
  const listed = await b.receive('entry_states_listed');
  assert.equal(listed.entries[0].entryId,'entry-1');
  assert.equal(listed.entries[0].revision,1);
  const r = await fetch(`${base}/v1/vaults/${state.vaultId}/blobs/blob-1`,{headers:{Authorization:`Bearer ${b.token}`}});
  assert.ok(r.ok, `download: ${r.status}`);
  assert.equal(await r.text(),payload);
  if (mode==='create') fs.writeFileSync('/data/test-state.json',JSON.stringify(state),{mode:0o600});
  console.log(`PASS ${mode}: session, vault, two WebSocket clients, committed blob download`);
} finally { a.ws.close(); b.ws.close(); }
