import { createClient } from 'redis';

const {
  REDIS_HOST = 'localhost',
  REDIS_PORT = '6379',
  REDIS_PASSWORD = ''
} = process.env;

let client;
let connecting = null;

async function ensureClient() {
  if (client?.isOpen) return client;
  if (connecting) return connecting;
  client = createClient({
    socket: { host: REDIS_HOST, port: Number(REDIS_PORT) },
    password: REDIS_PASSWORD || undefined
  });
  client.on('error', (err) => console.warn('redis error', err?.message || err));
  connecting = client.connect().catch((e) => {
    console.warn('redis connect failed', e?.message || e);
    return null;
  }).finally(() => { connecting = null; });
  await connecting;
  return client;
}

const PREFIX = 'cache:';

export async function cacheGet(key) {
  const c = await ensureClient();
  if (!c?.isOpen) return null;
  const raw = await c.get(PREFIX + key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function cacheSet(key, value, ttlSeconds = 60) {
  const c = await ensureClient();
  if (!c?.isOpen) return false;
  try {
    const s = JSON.stringify(value);
    await c.set(PREFIX + key, s, { EX: ttlSeconds });
    return true;
  } catch (e) {
    console.warn('cacheSet failed', key, e?.message || e);
    return false;
  }
}

export async function cacheDelPrefix(prefix) {
  const c = await ensureClient();
  if (!c?.isOpen) return 0;
  let cursor = '0';
  let total = 0;
  const match = PREFIX + prefix + '*';
  do {
    const res = await c.scan(cursor, { MATCH: match, COUNT: 100 });
    cursor = res.cursor;
    const keys = res.keys || res[1] || [];
    if (keys.length) total += await c.del(keys);
  } while (cursor !== '0');
  return total;
}

export function stableKeyFromQuery(obj) {
  const entries = Object.entries(obj || {}).flatMap(([k, v]) => {
    if (v == null) return [];
    if (Array.isArray(v)) return [[k, v.map(String).sort().join(',')]];
    return [[k, String(v)]];
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

