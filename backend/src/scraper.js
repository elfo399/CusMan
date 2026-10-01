import express from 'express';
import axios from 'axios';
import { z } from 'zod';
import { getPool } from './db.js';

// Environment keys (defaults). Prefer per-user key stored in Keycloak attributes.
const GOOGLE_PLACES_KEY_DEFAULT = process.env.GOOGLE_PLACES_KEY || '';
const HUNTER_KEY = process.env.HUNTER_KEY || '';

// Keycloak admin/env to read user attributes
const KC_URL = process.env.KEYCLOAK_URL || 'http://localhost:8081';
const KC_REALM = process.env.KEYCLOAK_REALM || 'cusman';
const KC_ADMIN_USERNAME = process.env.KEYCLOAK_ADMIN_USERNAME || 'admin';
const KC_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin';

const router = express.Router();

// Utilities
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function normStr(s) { return (s || '').toString().trim().toLowerCase().replace(/\s+/g,' '); }
function geoCell(lat, lng) { return `${lat.toFixed(3)},${lng.toFixed(3)}`; } // ~100-120m cells
function haversineMeters(lat1,lng1,lat2,lng2){ const R=6371000; const toRad=(d)=>d*Math.PI/180; const dLat=toRad(lat2-lat1); const dLng=toRad(lng2-lng1); const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(a)); }
// Jaro-Winkler (simplified) for name/address similarity
function jaroWinkler(s1, s2){ s1 = normStr(s1); s2 = normStr(s2); if(!s1||!s2) return 0; const mDist = Math.floor(Math.max(s1.length,s2.length)/2)-1; const s1Matches=new Array(s1.length).fill(false); const s2Matches=new Array(s2.length).fill(false); let matches=0; for(let i=0;i<s1.length;i++){ const start=Math.max(0,i-mDist); const end=Math.min(i+mDist+1,s2.length); for(let j=start;j<end;j++){ if(s2Matches[j]) continue; if(s1[i]!==s2[j]) continue; s1Matches[i]=true; s2Matches[j]=true; matches++; break; } } if(matches===0) return 0; let t=0; let k=0; for(let i=0;i<s1.length;i++){ if(!s1Matches[i]) continue; while(!s2Matches[k]) k++; if(s1[i]!==s2[k]) t++; k++; } t/=2; const j = (matches/s1.length + matches/s2.length + (matches - t)/matches)/3; const l = Math.min(4, [...s1].findIndex((c,i)=>s2[i]!==c) === -1 ? Math.min(4, s1.length, s2.length) : 0); return j + 0.1*l*(1-j); }

// Input validation
const SearchSchema = z.object({
  query: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius_m: z.number().int().min(50).max(50000),
  categories: z.array(z.string()).optional(),
  // sources removed; we only support Google Places for now
  limit: z.number().int().min(1).max(200).optional(),
  // Optional friendly name for the job
  name: z.string().min(1).max(255).optional()
});

const EnrichContactsSchema = z.object({
  website: z.string().url().optional(),
  domain: z.string().optional(),
  emails: z.array(z.string().email()).optional()
}).refine((d)=> !!(d.website||d.domain||d.emails?.length), { message: 'one of website|domain|emails[] required' });

async function ensureSchema() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL,
    progress INT NOT NULL DEFAULT 0,
    error TEXT NULL,
    params JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  // Ensure name column exists for older schemas (compatible with older MySQL)
  try {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'name'"
    );
    const has = Array.isArray(rows) && rows.length ? Number(rows[0].c) > 0 : false;
    if (!has) {
      try { await pool.query('ALTER TABLE jobs ADD COLUMN name VARCHAR(255) NULL AFTER id'); } catch {}
    }
  } catch {}
  // Ensure results_csv column exists to store extraction CSV snapshot per job
  try {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs' AND COLUMN_NAME = 'results_csv'"
    );
    const hasCol = Array.isArray(rows) && rows.length ? Number(rows[0].c) > 0 : false;
    if (!hasCol) {
      try { await pool.query('ALTER TABLE jobs ADD COLUMN results_csv LONGTEXT NULL AFTER params'); } catch {}
    }
  } catch {}
}

function newJobId() {
  return 'job_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function newPlaceId(name, address, lat, lng) {
  const base = normStr(name) + '|' + normStr(address) + '|' + geoCell(lat,lng);
  let h=0; for (let i=0;i<base.length;i++){ h = ((h<<5)-h) + base.charCodeAt(i); h|=0; }
  return 'pl_' + (h>>>0).toString(16).padStart(8,'0');
}

// Provider clients with basic backoff
async function httpGet(url, opts, attempt=1){
  try { return await axios.get(url, opts); } catch (e) {
    const code = e?.response?.status || 0;
    if ((code===429 || (code>=500 && code<600)) && attempt < 5) {
      const wait = Math.min(2000 * attempt, 8000);
      await sleep(wait);
      return httpGet(url, opts, attempt+1);
    }
    throw e;
  }
}

async function googleSearchAndDetails({ query, lat, lng, radius_m, limit=50 }, apiKey){
  const GOOGLE_PLACES_KEY = apiKey || GOOGLE_PLACES_KEY_DEFAULT;
  if (!GOOGLE_PLACES_KEY) return [];
  const out = [];
  const params = { query, location: `${lat},${lng}`, radius: radius_m, key: GOOGLE_PLACES_KEY };
  const gText = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
  let nextToken = null; let fetched = 0;
  do {
    const p = { ...params, pagetoken: nextToken || undefined };
    const r = await httpGet(gText, { params: p });
    const results = r.data?.results || [];
    for (const it of results) {
      if (fetched >= limit) break;
      const place_id = it.place_id;
      const fields = 'name,formatted_address,international_phone_number,website,rating,user_ratings_total,opening_hours,geometry,types,place_id';
      const det = await httpGet('https://maps.googleapis.com/maps/api/place/details/json', { params: { place_id, fields, key: GOOGLE_PLACES_KEY } });
      const d = det.data?.result || {};
      const lat2 = d.geometry?.location?.lat; const lng2 = d.geometry?.location?.lng;
      out.push({
        name: d.name,
        address: d.formatted_address,
        phone: d.international_phone_number || null,
        website: d.website || null,
        rating: d.rating || null,
        reviewsCount: d.user_ratings_total || null,
        lat: lat2, lng: lng2,
        openingHours: d.opening_hours || null,
        categories: d.types || [],
        placeIds: { google: d.place_id },
        source: 'google'
      });
      fetched++;
      if (fetched >= limit) break;
    }
    nextToken = r.data?.next_page_token || null;
    if (nextToken) await sleep(1500); // Google next_page_token warmup
  } while (nextToken && fetched < limit);
  return out;
}

// Yelp and Foursquare integrations removed

function csvEscape(v) {
  const s = String(v ?? '');
  return '"' + s.replaceAll('"','""') + '"';
}



function placesToCsv(places) {
  const header = ['id','name','site','city','category','email_1','email_2','email_3','phone_1','phone_2','phone_3','latitude','longitude','assign','contact_method','data_start','data_follow_up_1','data_follow_up_2','status','note'];
  const lines = [header.join(',')];
  for (const p of places) {
    const category = Array.isArray(p.categories) && p.categories.length ? String(p.categories[0]) : '';
    const city = guessCity(p.address || '') || '';
    const row = [
      '',
      p.name || '',
      p.website || '',
      city,
      category,
      '', '', '',
      p.phone || '',
      '', '',
      p.lat != null ? String(p.lat) : '',
      p.lng != null ? String(p.lng) : '',
      '', '', '', '', '',
      'Non contattato',
      ''
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

function parseCsv(text) {
  const out = [];
  if (!text) return out;
  const rows = [];
  let i = 0, cur = [], field = '', inQ = false;
  const pushField = () => { cur.push(field); field = ''; };
  const pushRow = () => { rows.push(cur); cur = []; };
  while (i < text.length) {
    const c = text[i++];
    if (inQ) {
      if (c === '"') {
        if (text[i] === '"') { field += '"'; i++; }
        else { inQ = false; }
      } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ',') { pushField(); continue; }
    if (c === '\n' || c === '\r') {
      // handle CRLF/CR
      if (c === '\r' && text[i] === '\n') i++;
      pushField(); pushRow();
      continue;
    }
    field += c;
  }
  // last field/row
  if (field.length || cur.length) { pushField(); pushRow(); }
  if (!rows.length) return out;
  const header = rows.shift().map(h => h.replace(/^\uFEFF/, '').trim());
  for (const r of rows) {
    const obj = {};
    for (let k = 0; k < header.length && k < r.length; k++) obj[header[k]] = r[k];
    out.push(obj);
  }
  return out;
}

function dedupPlaces(arr){
  const byKey = new Map();
  const result = [];
  for (const p of arr) {
    if (!p.name || !p.address || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
    const key = normStr(p.name)+'|'+normStr(p.address)+'|'+geoCell(p.lat,p.lng);
    const existingIdx = byKey.get(key);
    if (existingIdx != null) {
      // merge sources & ids
      const cur = result[existingIdx];
      cur.sources = Array.from(new Set([...(cur.sources||[]), p.source].filter(Boolean)));
      cur.placeIds = { ...(cur.placeIds||{}), ...(p.placeIds||{}) };
      // prefer website/phone if missing
      if (!cur.website && p.website) cur.website = p.website;
      if (!cur.phone && p.phone) cur.phone = p.phone;
      // prefer higher rating
      if ((p.rating||0) > (cur.rating||0)) cur.rating = p.rating;
    } else {
      const idx = result.length;
      byKey.set(key, idx);
      result.push({ ...p, sources: [p.source].filter(Boolean) });
    }
  }
  // fuzzy second pass for names within 50m
  const final = [];
  for (const p of result) {
    const dup = final.find(q => haversineMeters(p.lat,p.lng,q.lat,q.lng) <= 50 && jaroWinkler(p.name, q.name) >= 0.88);
    if (dup) {
      dup.sources = Array.from(new Set([...(dup.sources||[]), ...(p.sources||[])]));
      dup.placeIds = { ...(dup.placeIds||{}), ...(p.placeIds||{}) };
      if (!dup.website && p.website) dup.website = p.website;
      if (!dup.phone && p.phone) dup.phone = p.phone;
      if ((p.rating||0) > (dup.rating||0)) dup.rating = p.rating;
    } else final.push(p);
  }
  return final;
}

async function saveJobResults(jobId, places){
  const pool = getPool();
  const conn = awaitsafe(await pool.getConnection());
  try {
    await conn.beginTransaction();
  for (const p of places) {
    const id = newPlaceId(p.name, p.address, p.lat, p.lng);
    const cell = geoCell(p.lat, p.lng);
    await conn.execute(
      `REPLACE INTO places (id, job_id, name, address, phone, website, rating, lat, lng, opening_hours, categories, place_ids, sources, cell)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, jobId, p.name, p.address, p.phone, p.website, p.rating, p.lat, p.lng,
        JSON.stringify(p.openingHours||null), JSON.stringify(p.categories||[]), JSON.stringify(p.placeIds||{}), JSON.stringify(p.sources||[]), cell]
    );
    }
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    try { conn.release(); } catch {}
  }
}

function awaitsafe(p){ return p; }

function formatDateIT(d) {
  try {
    return new Intl.DateTimeFormat('it-IT').format(d);
  } catch {
    const pad = (n)=> String(n).padStart(2,'0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
  }
}

function formatDateTimeIT(d) {
  try {
    const date = new Intl.DateTimeFormat('it-IT').format(d);
    const time = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(d);
    return `${date} ${time}`;
  } catch {
    const pad = (n)=> String(n).padStart(2,'0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

// POST /v1/search -> create job and enqueue background processing
router.post('/v1/search', async (req, res) => {
  try {
    await ensureSchema();
    // Resolve Google Places API key: prefer per-user Keycloak attribute, fallback to env default
    const apiKey = await getGooglePlacesKeyFromRequest(req);
    if (!apiKey) {
      return res.status(400).json({ error: 'missing_google_places_key' });
    }
    const parsed = SearchSchema.parse({
      query: req.body?.query,
      lat: Number(req.body?.lat),
      lng: Number(req.body?.lng),
      radius_m: Number(req.body?.radius_m),
      categories: req.body?.categories,
      limit: req.body?.limit != null ? Number(req.body?.limit) : undefined,
      name: (req.body?.name || undefined)
    });
    const jobId = newJobId();
    const pool = getPool();
    const now = new Date();
    const prelimName = `${'Sconosciuta'} ${formatDateTimeIT(now)} ${parsed.radius_m}m ${parsed.limit ?? 50}`;
    const initialName = (parsed.name && String(parsed.name).trim()) ? String(parsed.name).trim() : prelimName;
    await pool.execute('INSERT INTO jobs (id, name, status, progress, params) VALUES (?,?,?,?,?)', [jobId, initialName, 'queued', 0, JSON.stringify(parsed)]);

    // Background worker (in-process)
    setImmediate(async () => {
      const upd = async (fields) => {
        const keys = Object.keys(fields);
        const sets = keys.map(k=>`${k} = ?`).join(', ');
        const vals = keys.map(k=>fields[k]);
        await pool.execute(`UPDATE jobs SET ${sets} WHERE id = ?`, [...vals, jobId]);
      };
      try {
        await upd({ status: 'running', progress: 0, error: null });
        const all = [];
        const steps = 1; // only Google
        let done = 0;
        all.push(...await googleSearchAndDetails(parsed, apiKey)); await upd({ progress: Math.round((++done/steps)*100) });
        const unique = dedupPlaces(all);
        // Persist CSV snapshot directly on the job row
        try {
          const csv = placesToCsv(unique);
          await pool.execute('UPDATE jobs SET results_csv = ? WHERE id = ?', [csv, jobId]);
        } catch {}
        // Derive a friendly name: "<city> <date>"
        let city = null;
        try {
          const counts = new Map();
          for (const p of unique) {
            const c = guessCity(p.address || '') || null;
            if (!c) continue;
            counts.set(c, (counts.get(c) || 0) + 1);
          }
          let best = null; let bestCount = 0;
          for (const [k,v] of counts.entries()) { if (v > bestCount) { best = k; bestCount = v; } }
          city = best || null;
        } catch {}
        const effLimit = parsed.limit != null ? Number(parsed.limit) : 50;
        const name = `${city || 'Sconosciuta'} ${formatDateTimeIT(new Date())} ${parsed.radius_m}m ${effLimit}`;
        // If user provided a custom name, keep it; otherwise set our computed friendly name
        if ((parsed.name && String(parsed.name).trim())) {
          await upd({ status: 'completed', progress: 100 });
        } else {
          await upd({ status: 'completed', progress: 100, name });
        }
      } catch (e) {
        await pool.execute('UPDATE jobs SET status = ?, error = ? WHERE id = ?', ['failed', String(e?.message || e), jobId]);
      }
    });

    res.json({ jobId });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'invalid_input', details: e.issues });
    res.status(500).json({ error: 'job_create_failed' });
  }
});

// GET /v1/jobs/:id -> job status
router.get('/v1/jobs/:id', async (req, res) => {
  try {
    await ensureSchema();
    const pool = getPool();
    const [rows] = await pool.query('SELECT id, name, status, progress, error, created_at FROM jobs WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: 'job_fetch_failed' });
  }
});

// GET /v1/jobs/:id/count -> number of rows that will be imported (CSV lines excluding header)
router.get('/v1/jobs/:id/count', async (req, res) => {
  try {
    await ensureSchema();
    const pool = getPool();
    const [[row]] = await pool.query('SELECT results_csv FROM jobs WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const csv = row.results_csv || '';
    const lines = (csv ? String(csv) : '').split(/\r?\n/).filter((l) => l.trim().length > 0);
    const total = Math.max(0, lines.length - 1);
    res.json({ total });
  } catch (e) {
    res.status(500).json({ error: 'count_failed' });
  }
});

// List jobs (recent first)
router.get('/v1/jobs', async (req, res) => {
  try {
    await ensureSchema();
    const pool = getPool();
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const [rows] = await pool.query('SELECT id, name, status, progress, error, created_at, params FROM jobs ORDER BY created_at DESC LIMIT ?', [limit]);
    const out = rows.map((r) => ({
      id: r.id,
      name: r.name || null,
      status: r.status,
      progress: r.progress,
      error: r.error || null,
      created_at: r.created_at,
      params: (() => { try { return JSON.parse(r.params || '{}'); } catch { return {}; } })()
    }));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: 'jobs_list_failed' });
  }
});

// GET /v1/jobs/:id/places?limit=20 -> preview rows
router.get('/v1/jobs/:id/places', async (req, res) => {
  try {
    await ensureSchema();
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const pool = getPool();
    const [rows] = await pool.query('SELECT results_csv FROM jobs WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const csv = rows[0].results_csv || '';
    const arr = parseCsv(csv);
    // map to preview objects similar to previous output
    const items = arr.map((r) => ({
      name: r['name'] || '',
      address: r['city'] || '',
      phone: r['phone_1'] || null,
      website: r['site'] || null,
      rating: null,
      reviewsCount: null,
      lat: r['latitude'] ? Number(r['latitude']) : null,
      lng: r['longitude'] ? Number(r['longitude']) : null,
      categories: r['category'] ? [String(r['category'])] : []
    }));
    const slice = items.slice(offset, offset + limit);
    res.json(slice);
  } catch (e) {
    res.status(500).json({ error: 'preview_failed' });
  }
});

function guessCity(address) {
  if (!address) return null;
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return null;
}

// POST /v1/jobs/:id/import -> insert places as clienti rows (minimal fields)
router.post('/v1/jobs/:id/import', async (req, res) => {
  try {
    await ensureSchema();
    const pool = getPool();
    const [[row]] = await pool.query('SELECT results_csv FROM jobs WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const csv = row.results_csv || '';
    const arr = parseCsv(csv);
    let inserted = 0;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const r of arr) {
        const name = (r['name'] || '').toString().trim();
        if (!name) continue;
        const site = (r['site'] || '') || null;
        const city = (r['city'] || '') || null;
        const category = (r['category'] || '') || null;
        const phone = (r['phone_1'] || '') || null;
        await conn.execute(
          'INSERT INTO clienti (name, city, category, site, phone_1, status) VALUES (?, ?, ?, ?, ?, ?)',
          [name, city, category, site, phone, 'Non contattato']
        );
        inserted++;
      }
      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch {}
      throw e;
    } finally {
      try { conn.release(); } catch {}
    }
    res.json({ inserted, total: arr.length });
  } catch (e) {
    res.status(500).json({ error: 'import_failed' });
  }
});

// GET /v1/export/:id?format=csv|json
router.get('/v1/export/:id', async (req, res) => {
  try {
    await ensureSchema();
    const format = (req.query.format || 'json').toString();
    const pool = getPool();
    const [[row]] = await pool.query('SELECT results_csv FROM jobs WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const csv = row.results_csv || '';
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="export_${req.params.id}.csv"`);
      res.end(csv || '');
    } else {
      const arr = parseCsv(csv);
      // Normalize a compact JSON like previous places rows
      const json = arr.map((r) => ({
        name: r['name'] || '',
        address: r['city'] || '',
        phone: r['phone_1'] || null,
        website: r['site'] || null,
        lat: r['latitude'] ? Number(r['latitude']) : null,
        lng: r['longitude'] ? Number(r['longitude']) : null,
        categories: r['category'] ? [String(r['category'])] : []
      }));
      const jsonl = (req.query.format || '').toString() === 'jsonl';
      if (jsonl) {
        for (const it of json) res.write(JSON.stringify(it)+'\n');
        res.end();
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(json));
      }
    }
  } catch (e) {
    res.status(500).json({ error: 'export_failed' });
  }
});

// POST /v1/enrich-contacts -> Hunter (optional)
router.post('/v1/enrich-contacts', async (req, res) => {
  try {
    const parsed = EnrichContactsSchema.parse(req.body || {});
    if (!HUNTER_KEY) return res.json({ emails: [], note: 'HUNTER_KEY missing' });
    const domain = parsed.domain || (parsed.website ? new URL(parsed.website).hostname : null);
    const found = [];
    if (domain) {
      try {
        const r = await httpGet('https://api.hunter.io/v2/domain-search', { params: { domain, api_key: HUNTER_KEY, type: 'personal' } });
        const arr = r.data?.data?.emails || [];
        for (const e of arr) {
          found.push({ value: e.value, confidence: e.confidence || null, source: 'hunter' });
        }
      } catch {}
    }
    const inputEmails = parsed.emails || [];
    // Minimal verify pass (format only). Real verification would call Hunter/ZeroBounce verify endpoint respecting ToS/quotas
    const emails = Array.from(new Set([...found.map(x=>x.value), ...inputEmails]));
    res.json({ emails });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'invalid_input', details: e.issues });
    res.status(500).json({ error: 'enrich_failed' });
  }
});

export default router;

// --- Helpers to read per-user key from Keycloak ---
function decodeSubFromJwt(token) {
  const parts = token.split('.')
  if (parts.length < 2) throw new Error('invalid_jwt');
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const payload = JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf8'));
  if (!payload.sub) throw new Error('no_sub');
  return payload.sub;
}

async function getUserSubFromRequest(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('missing_token');
  const token = auth.substring(7);
  try {
    return decodeSubFromJwt(token);
  } catch (e) {
    const resp = await fetch(`${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/userinfo`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error('invalid_token');
    const info = await resp.json();
    return info.sub;
  }
}

async function getAdminToken() {
  const body = new URLSearchParams();
  body.set('client_id', 'admin-cli');
  body.set('grant_type', 'password');
  body.set('username', KC_ADMIN_USERNAME);
  body.set('password', KC_ADMIN_PASSWORD);
  const resp = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!resp.ok) throw new Error('admin_auth_failed');
  const json = await resp.json();
  return json.access_token;
}

async function getUserById(adminToken, userId) {
  const r = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users/${userId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  if (!r.ok) throw new Error('user_fetch_failed');
  return await r.json();
}

async function getGooglePlacesKeyFromRequest(req) {
  try {
    const sub = await getUserSubFromRequest(req);
    const admin = await getAdminToken();
    const u = await getUserById(admin, sub);
    const attrs = u.attributes || {};
    const gp = Array.isArray(attrs.google_places_key) ? attrs.google_places_key[0] : attrs.google_places_key;
    const val = (gp && String(gp).trim()) || '';
    return val;
  } catch {
    return '';
  }
}
