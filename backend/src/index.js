import express from "express";
import cors from "cors";
import dotenv from "dotenv";
// Avatar upload removed; no file handling
import clientiRouter from "./clienti.js";
import scraperRouter from "./scraper.js";
import partnerRouter from "./partner.js";
import { cacheGet, cacheSet, stableKeyFromQuery } from './cache.js';
import { ping as dbPing, getPool } from "./db.js";
import { registerSwagger } from './swagger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
// Default to localhost Keycloak in dev; docker-compose overrides to http://idp:8080
const KC_URL = process.env.KEYCLOAK_URL || "http://localhost:8081";
const KC_REALM = process.env.KEYCLOAK_REALM || "cusman";
const KC_ADMIN_USERNAME = process.env.KEYCLOAK_ADMIN_USERNAME || "admin";
const KC_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD || "admin";

app.use(cors());
// Allow slightly larger payloads for batch import
app.use(express.json({ limit: '5mb' }));
// No uploads static directory
// No request logging middleware

// Swagger/OpenAPI UI and JSON
// UI: /api-docs, JSON: /api-docs.json
registerSwagger(app, { route: '/api-docs' });

// --- One-time demo seed for partner table (dev only) ---
async function initPartnerDemo() {
  try {
    const pool = getPool();
    // Ensure table exists (minimal schema)
    await pool.query(`CREATE TABLE IF NOT EXISTS clienti_partner (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(150) NOT NULL,
      referent VARCHAR(150) NULL,
      email VARCHAR(150) NULL,
      phone VARCHAR(30) NULL,
      address VARCHAR(255) NULL,
      site VARCHAR(255) NULL,
      domain VARCHAR(255) NULL,
      domain_expiry DATE NULL,
      hosting_provider VARCHAR(100) NULL,
      hosting_expiry DATE NULL,
      ssl_expiry DATE NULL,
      panel_url VARCHAR(255) NULL,
      status VARCHAR(100) NULL,
      assign VARCHAR(100) NULL,
      data_start DATE NULL,
      data_end DATE NULL,
      renew_date DATE NULL,
      price DECIMAL(10,2) NULL,
      note TEXT NULL,
      PRIMARY KEY (id),
      KEY idx_status (status),
      KEY idx_assign (assign)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`);
    // Insert demo only if table is empty
    await pool.query(
      `INSERT INTO clienti_partner 
        (name, referent, email, phone, address, site, domain, domain_expiry, hosting_provider, hosting_expiry, ssl_expiry, panel_url, status, assign, data_start, data_end, renew_date, price, note)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
       WHERE NOT EXISTS (SELECT 1 FROM clienti_partner LIMIT 1)`,
      [
        'Acme S.r.l.',
        'Mario Rossi',
        'mario.rossi@acme.example',
        '+39 320 123 4567',
        'Via Roma 1, Bari',
        'https://www.acme.example',
        'acme.example',
        new Date(Date.now() + 180*24*60*60*1000),
        'NetHost',
        new Date(Date.now() + 150*24*60*60*1000),
        new Date(Date.now() + 120*24*60*60*1000),
        'https://panel.nethost.example',
        'attivo',
        'alfonso',
        new Date(),
        new Date(Date.now() + 365*24*60*60*1000),
        new Date(Date.now() + 150*24*60*60*1000),
        950.00,
        'Cliente demo inserito automaticamente'
      ]
    );
  } catch (e) {
    console.warn('partner demo init failed', e?.message || String(e));
  }
}

function decodeSubFromJwt(token) {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("invalid_jwt");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const payload = JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8"));
  if (!payload.sub) throw new Error("no_sub");
  return payload.sub;
}

async function getUserSubFromRequest(req) {
  const auth = req.headers["authorization"] || "";
  if (!auth || !auth.startsWith("Bearer ")) {
    console.warn("Auth missing on", req.method, req.url);
    throw new Error("missing_token");
  }
  const token = auth.substring(7);
  // Prefer local decode to avoid dependency on Keycloak /userinfo in dev
  try {
    return decodeSubFromJwt(token);
  } catch (e) {
    // Fallback to userinfo call if decode fails
    const resp = await fetch(`${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/userinfo`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) {
      console.warn("userinfo failed", resp.status);
      throw new Error("invalid_token");
    }
    const info = await resp.json();
    return info.sub;
  }
}

async function getAdminToken() {
  const body = new URLSearchParams();
  body.set("client_id", "admin-cli");
  body.set("grant_type", "password");
  body.set("username", KC_ADMIN_USERNAME);
  body.set("password", KC_ADMIN_PASSWORD);
  const resp = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!resp.ok) throw new Error("admin_auth_failed");
  const json = await resp.json();
  return json.access_token;
}

async function getUserById(adminToken, userId) {
  const r = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users/${userId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  if (!r.ok) throw new Error("user_fetch_failed");
  return await r.json();
}

// Ensure user profile has a managed attribute so Keycloak persists it
async function ensureUserProfileAttribute(adminToken, name) {
  try {
    const profRes = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users/profile`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!profRes.ok) return false;
    const profile = await profRes.json();
    const attrs = Array.isArray(profile?.attributes) ? profile.attributes : [];
    const idx = attrs.findIndex((a) => a?.name === name);
    const baseAttr = {
      name,
      displayName: name,
      validations: {},
      permissions: { view: ["admin"], edit: ["admin"] },
      annotations: { inputType: "text", multivalued: false }
    };
    let updatedAttrs;
    if (idx >= 0) {
      const cur = attrs[idx] || {};
      const cleaned = {
        ...baseAttr,
        displayName: cur.displayName || name
      };
      updatedAttrs = attrs.slice();
      updatedAttrs[idx] = cleaned;
    } else {
      updatedAttrs = [...attrs, baseAttr];
    }
    const next = { ...profile, attributes: updatedAttrs };
    const put = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(next)
    });
    return put.ok;
  } catch (e) {
    console.warn('ensureUserProfileAttribute failed', e?.message || String(e));
    return false;
  }
}

function publicUser(u) {
  const attrs = u.attributes || {};
  const gplaces = Array.isArray(attrs.google_places_key) ? attrs.google_places_key[0] : attrs.google_places_key;
  return {
    id: u.id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    emailVerified: u.emailVerified,
    hasGooglePlacesKey: !!(gplaces && String(gplaces).trim())
  };
}

// Healthcheck per docker/monitoring
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// DB health
app.get("/health/db", async (_req, res) => {
  try {
    const ok = await dbPing();
    res.json({ db: ok ? "up" : "down" });
  } catch {
    res.status(500).json({ db: "down" });
  }
});

// Route di test
/**
 * @openapi
 * /api/hello:
 *   get:
 *     summary: Endpoint di test
 *     tags: [Health]
 *     responses:
 *       200: { description: OK }
 */
app.get("/api/hello", (_req, res) => {
  res.json({ message: "Hello from Express backend" });
});

// API: clienti da chiamare (solo campi necessari dal DB)
app.get("/api/clienti-da-chiamare", async (req, res) => {
  try {
    const pool = getPool();
    const q = (req.query.q || "").toString().trim();
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const sort = (req.query.sort || 'id').toString();
    const dir = ((req.query.dir || 'desc').toString().toLowerCase() === 'asc') ? 'ASC' : 'DESC';

    const parseMulti = (key) => {
      const v = req.query[key];
      if (!v) return [];
      if (Array.isArray(v)) return v.flatMap((s) => s.split(',').map((x) => x.trim()).filter(Boolean));
      return v.toString().split(',').map((x) => x.trim()).filter(Boolean);
    };
    const cities = parseMulti('city');
    const categories = parseMulti('category');
    const statuses = parseMulti('status');
    const assigns = parseMulti('assign');

    let sql = "SELECT id, name, city, category, assign, status, site, data_start, data_follow_up_1, data_follow_up_2 FROM clienti";
    const where = [];
    const params = [];
    if (q) { where.push("name LIKE ?"); params.push(`%${q}%`); }
    if (cities.length) { where.push(`city IN (${cities.map(()=>'?').join(',')})`); params.push(...cities); }
    if (categories.length) { where.push(`category IN (${categories.map(()=>'?').join(',')})`); params.push(...categories); }
    if (statuses.length) { where.push(`status IN (${statuses.map(()=>'?').join(',')})`); params.push(...statuses); }
    if (assigns.length) { where.push(`assign IN (${assigns.map(()=>'?').join(',')})`); params.push(...assigns); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    // Build COUNT(*) with same WHERE
    const countSql = `SELECT COUNT(*) AS total FROM clienti${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
    const [countRows] = await pool.query(countSql, params);
    const total = countRows?.[0]?.total || 0;

    // Sorting (whitelisted columns)
    const allowedSort = new Set(['id','name','city','category','status','assign']);
    const sortCol = allowedSort.has(sort) ? sort : 'id';
    sql += ` ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`;
    const runParams = [...params, limit, offset];

    // Cache by normalized query string
    const cacheKey = `clienti-da-chiamare:${stableKeyFromQuery({ q, limit, offset, sort, dir, city: cities, category: categories, status: statuses, assign: assigns })}`;
    const hit = await cacheGet(cacheKey);
    if (hit && hit.body) {
      if (hit.headers?.total != null) res.setHeader('X-Total-Count', String(hit.headers.total));
      res.setHeader('X-Cache', 'HIT');
      return res.json(hit.body);
    }

    const [rows] = await pool.query(sql, runParams);
    const mapped = rows.map((r) => ({
      id: r.id,
      nome: r.name,
      citta: r.city,
      categoria: r.category,
      assegnato: r.assign,
      stato: r.status,
      site: r.site,
      data_start: r.data_start || null,
      data_follow_up_1: r.data_follow_up_1 || null,
      data_follow_up_2: r.data_follow_up_2 || null
    }));
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('X-Cache', 'MISS');
    // store small payload in cache (short TTL)
    await cacheSet(cacheKey, { body: mapped, headers: { total } }, 45);
    res.json(mapped);
  } catch (e) {
    res.status(500).json({ error: "list_failed" });
  }
});

// Current user profile (from Keycloak) enriched with avatar attribute
app.get("/api/me", async (req, res) => {
  try {
    const sub = await getUserSubFromRequest(req);
    const admin = await getAdminToken();
    const u = await getUserById(admin, sub);
    res.json(publicUser(u));
  } catch (e) {
    res.status(401).json({ error: "unauthorized" });
  }
});

// Update current user details (firstName, lastName, email)
app.put("/api/me", async (req, res) => {
  try {
    const sub = await getUserSubFromRequest(req);
    const { firstName, lastName, email } = req.body || {};
    const admin = await getAdminToken();
    // Load existing user and update only intended fields, preserving others
    const existing = await getUserById(admin, sub);
    const payload = {
      username: existing.username,
      enabled: existing.enabled !== false,
      emailVerified: !!existing.emailVerified,
      firstName: firstName != null ? firstName : existing.firstName,
      lastName: lastName != null ? lastName : existing.lastName,
      email: email != null ? email : existing.email,
      attributes: existing.attributes || {},
      requiredActions: Array.isArray(existing.requiredActions) ? existing.requiredActions : []
    };
    const r = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users/${sub}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error("update_failed");
    const updated = await getUserById(admin, sub);
    res.json(publicUser(updated));
  } catch (e) {
    res.status(400).json({ error: "update_failed" });
  }
});

// Avatar upload endpoints removed

// Save or clear Google Places API key in user's Keycloak attributes
app.put("/api/me/google-places-key", async (req, res) => {
  try {
    const sub = await getUserSubFromRequest(req);
    const admin = await getAdminToken();
    const { key } = req.body || {};
    // Make sure KC persists this custom attribute by defining it in User Profile
    await ensureUserProfileAttribute(admin, 'google_places_key');
    const user = await getUserById(admin, sub);
    const attributes = { ...(user.attributes || {}) };
    const trimmed = (typeof key === 'string') ? key.trim() : '';
    if (!trimmed) {
      // clear by removing the attribute (not required in profile)
      delete attributes.google_places_key;
    } else {
      attributes.google_places_key = [trimmed];
    }
    const r = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users/${sub}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: user.username,
        enabled: user.enabled !== false,
        emailVerified: !!user.emailVerified,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        attributes,
        requiredActions: Array.isArray(user.requiredActions) ? user.requiredActions : []
      })
    });
    if (!r.ok) {
      const txt = await r.text().catch(()=> '');
      console.warn('KC save attr failed', r.status, txt);
      throw new Error('save_failed');
    }
    // Try refetch; if attribute not visible yet, return merged local user view (optimistic)
    try {
      const updated = await getUserById(admin, sub);
      const a = updated?.attributes || {};
      const gp = Array.isArray(a.google_places_key) ? a.google_places_key[0] : a.google_places_key;
      const has = !!(gp && String(gp).trim());
      if (!has && trimmed) {
        return res.json(publicUser({ ...updated, attributes }));
      }
      return res.json(publicUser(updated));
    } catch {
      return res.json(publicUser({ ...user, attributes }));
    }
  } catch (e) {
    res.status(400).json({ error: 'save_google_key_failed' });
  }
});

app.delete("/api/me/google-places-key", async (req, res) => {
  try {
    const sub = await getUserSubFromRequest(req);
    const admin = await getAdminToken();
    // Ensure the attribute is not required and has no NotEmpty validator
    await ensureUserProfileAttribute(admin, 'google_places_key');
    const user = await getUserById(admin, sub);
    const attributes = { ...(user.attributes || {}) };
    delete attributes.google_places_key;
    let r = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users/${sub}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: user.username,
        enabled: user.enabled !== false,
        emailVerified: !!user.emailVerified,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        attributes,
        requiredActions: Array.isArray(user.requiredActions) ? user.requiredActions : []
      })
    });
    if (!r.ok) {
      const txt = await r.text().catch(()=> '');
      console.warn('KC delete attr failed', r.status, txt);
      // Retry using empty list (some profiles require attribute key present but empty)
      try {
        const withEmpty = { ...(user.attributes || {}), google_places_key: [] };
        r = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users/${sub}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: user.username,
            enabled: user.enabled !== false,
            emailVerified: !!user.emailVerified,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            attributes: withEmpty,
            requiredActions: Array.isArray(user.requiredActions) ? user.requiredActions : []
          })
        });
      } catch {}
      if (!r.ok) {
        const txt2 = await r.text().catch(()=> '');
        console.warn('KC delete attr retry(empty) failed', r.status, txt2);
      }
      // Verify state: if attribute already absent/empty, return success (idempotent)
      try {
        const check = await getUserById(admin, sub);
        const a = check?.attributes || {};
        const gp = Array.isArray(a.google_places_key) ? a.google_places_key[0] : a.google_places_key;
        const has = !!(gp && String(gp).trim());
        if (!has) return res.json(publicUser(check));
      } catch {}
      return res.status(400).json({ error: 'delete_google_key_failed' });
    }
    // Success path: refetch and return
    try {
      const updated = await getUserById(admin, sub);
      return res.json(publicUser(updated));
    } catch {
      return res.json(publicUser({ ...user, attributes }));
    }
  } catch (e) {
    res.status(400).json({ error: 'delete_google_key_failed' });
  }
});

// Diagnostics: return raw attributes as seen by Keycloak Admin API
app.get("/api/me/attributes", async (req, res) => {
  try {
    const sub = await getUserSubFromRequest(req);
    const admin = await getAdminToken();
    const u = await getUserById(admin, sub);
    res.json({ attributes: u.attributes || {} });
  } catch (e) {
    res.status(400).json({ error: 'fetch_attributes_failed' });
  }
});

// Trigger Keycloak verification email for current user
// Uses Admin API execute-actions-email with VERIFY_EMAIL action
// Email verification flow removed

// CRUD Clienti (MySQL)
app.use("/api/clienti", clientiRouter);
// Scraper / Enricher APIs under /api
app.use("/api", scraperRouter);
// Partner minimal CRUD
app.use("/api/partner", partnerRouter);

// Users list from Keycloak (for assignment select)
app.get("/api/users", async (_req, res) => {
  try {
    const hit = await cacheGet('users:list');
    if (hit) { res.setHeader('X-Cache', 'HIT'); return res.json(hit); }
    const admin = await getAdminToken();
    const r = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users?max=1000`, {
      headers: { Authorization: `Bearer ${admin}` }
    });
    if (!r.ok) return res.status(500).json({ error: 'users_fetch_failed' });
    const arr = await r.json();
    const users = arr.map((u) => ({
      id: u.id,
      username: u.username,
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      email: u.email || ''
    }));
    await cacheSet('users:list', users, 300);
    res.setHeader('X-Cache', 'MISS');
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'users_fetch_failed' });
  }
});

// Aggregation: contacts by status for charts
// Returns: [{ status: string, total: number }, ...]
app.get("/api/contacts-by-status", async (_req, res) => {
  try {
    const hit = await cacheGet('contacts-by-status');
    if (hit) { res.setHeader('X-Cache', 'HIT'); return res.json(hit); }
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT COALESCE(NULLIF(TRIM(`status`), ''), 'Unknown') AS status, COUNT(*) AS total FROM `clienti` GROUP BY 1 ORDER BY total DESC"
    );
    const payload = rows.map(r => ({ status: r.status, total: Number(r.total) }));
    await cacheSet('contacts-by-status', payload, 60);
    res.setHeader('X-Cache', 'MISS');
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: 'aggregation_failed' });
  }
});

// Pie data: assigned share for a given username (assign)
// Example: GET /api/assign-share?assign=john -> { mine, others, total }
app.get("/api/assign-share", async (req, res) => {
  try {
    const username = (req.query.assign || "").toString().trim();
    const pool = getPool();
    // Cache by username
    const key = `assign-share:${username || 'all'}`;
    const hit = await cacheGet(key);
    if (hit) { res.setHeader('X-Cache', 'HIT'); return res.json(hit); }

    const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM clienti");
    let mine = 0;
    if (username) {
      const [[row]] = await pool.query("SELECT COUNT(*) AS c FROM clienti WHERE assign = ?", [username]);
      mine = Number(row?.c || 0);
    }
    const payload = { mine: Number(mine), others: Math.max(0, Number(total) - Number(mine)), total: Number(total) };
    await cacheSet(key, payload, 10);
    res.setHeader('X-Cache', 'MISS');
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: 'assign_share_failed' });
  }
});

(async () => {
  await initPartnerDemo();
  app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
  });
})();
// No error logging middleware

