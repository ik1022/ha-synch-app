import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function validateOptions(options) {
  const value = options.public_url;
  if (typeof value !== 'string' || /\s/.test(value)) throw new Error('public_url must be an HTTP(S) origin');
  let url;
  try { url = new URL(value); } catch { throw new Error('Set public_url to the address clients use'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error('public_url must have no path, credentials, query or fragment');
  const emails = options.allowed_emails;
  if (!Array.isArray(emails) || emails.length === 0 || emails.some(e =>
    typeof e !== 'string' || !/^[^\s@,]+@[^\s@,]+$/.test(e.trim()))) {
    throw new Error('allowed_emails must contain at least one valid email address');
  }
  const timeout = options.request_timeout_ms ?? 300000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 1500000) throw new Error('request_timeout_ms must be 1000..1500000');
  return { publicUrl: url.origin, emails: [...new Set(emails.map(e => e.trim().toLowerCase()))].join(','), timeout };
}

export function loadSecrets(root) {
  const filename = path.join(root, 'synch-secrets.json');
  if (fs.existsSync(filename)) {
    const keys = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!['auth', 'sync'].every(k => typeof keys[k] === 'string' && /^[a-f0-9]{64}$/.test(keys[k])) || keys.auth === keys.sync) {
      throw new Error('Invalid synch-secrets.json; restore it from the App backup');
    }
    return keys;
  }
  const storage = path.join(root, 'synch');
  if (fs.existsSync(storage) && fs.readdirSync(storage).length) throw new Error('Existing data has no synch-secrets.json; restore keys from backup');
  const keys = { auth: crypto.randomBytes(32).toString('hex'), sync: crypto.randomBytes(32).toString('hex') };
  const temporary = filename + '.tmp';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(keys)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, filename);
  return keys;
}

async function main() {
  process.umask(0o077);
  const root = '/data';
  fs.mkdirSync(root, { recursive: true });
  const options = validateOptions(JSON.parse(fs.readFileSync(path.join(root, 'options.json'), 'utf8')));
  const keys = loadSecrets(root);
  const storage = path.join(root, 'synch');
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o711);
  fs.chownSync(storage, 1000, 1000); // Official Node image's node user.
  const env = { PATH: process.env.PATH, TZ: process.env.TZ, LANG: process.env.LANG,
    NODE_ENV: 'production', HOME: '/home/node', DATA_DIR: storage,
    HOST: '0.0.0.0', PORT: '8787', BLOB_STORAGE: 'disk',
    PUBLIC_URL: options.publicUrl, CORS_ORIGIN: options.publicUrl,
    AUTH_ALLOWED_EMAILS: options.emails, REQUEST_TIMEOUT_MS: String(options.timeout),
    BETTER_AUTH_SECRET: keys.auth, SYNC_TOKEN_SECRET: keys.sync };
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value;
  process.setgroups([]);
  process.setgid(1000);
  process.setuid(1000);
  console.log('[app] Starting Synch with local disk storage on port 8787');
  if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(options.publicUrl).hostname)) {
    console.warn('[app] public_url uses loopback; other devices need this server\'s LAN IP or DNS name');
  }
  // Same process: upstream handles SIGTERM and closes SQLite/WebSocket connections.
  await import('/app/apps/api/dist/server.mjs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('[app]', error.message); process.exitCode = 1; });
}
