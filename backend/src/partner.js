import { Router } from "express";
import { getPool } from "./db.js";

const router = Router();

async function ensurePartnerSchema() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS clienti_partner (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(150) NOT NULL,
    referent VARCHAR(150) NULL,
    email VARCHAR(150) NULL,
    phone VARCHAR(30) NULL,
    address VARCHAR(255) NULL,
    site VARCHAR(255) NULL,
    domain VARCHAR(255) NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    useGPS TINYINT(1) NULL,
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
  // Ensure coords columns exist on older schemas (MySQL before IF NOT EXISTS compatible)
  try {
    const [r1] = await pool.query(
      "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clienti_partner' AND COLUMN_NAME = 'latitude'"
    );
    if (!Array.isArray(r1) || Number(r1[0]?.c || 0) === 0) {
      await pool.query("ALTER TABLE clienti_partner ADD COLUMN latitude DECIMAL(10,7) NULL AFTER domain");
    }
  } catch {}
  try {
    const [r2] = await pool.query(
      "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clienti_partner' AND COLUMN_NAME = 'longitude'"
    );
    if (!Array.isArray(r2) || Number(r2[0]?.c || 0) === 0) {
      await pool.query("ALTER TABLE clienti_partner ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude");
    }
  } catch {}
  try {
    const [r3] = await pool.query(
      "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clienti_partner' AND COLUMN_NAME = 'useGPS'"
    );
    if (!Array.isArray(r3) || Number(r3[0]?.c || 0) === 0) {
      await pool.query("ALTER TABLE clienti_partner ADD COLUMN useGPS TINYINT(1) NULL AFTER longitude");
    }
  } catch {}
}

// Helper: whitelist fields to prevent accidental/unsafe writes
const FIELDS = [
  'name','referent','email','phone','address','site','domain','latitude','longitude','useGPS','domain_expiry','hosting_provider','hosting_expiry','ssl_expiry','panel_url','status','assign','data_start','data_end','renew_date','price','note'
];
const NUMERIC_FIELDS = new Set(['latitude','longitude','price']);

function pickData(body) {
  const out = {};
  for (const k of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, k)) continue;
    let v = body[k];
    if (v === '') v = null;
    if (k === 'useGPS') {
      // Normalize boolean to 0/1
      if (v == null) v = 0; else v = v ? 1 : 0;
    } else if (NUMERIC_FIELDS.has(k)) {
      if (v == null || v === '') { v = null; }
      else {
        if (typeof v === 'string') v = v.replace(',', '.').trim();
        const n = Number(v);
        v = Number.isFinite(n) ? n : null;
      }
    }
    out[k] = v;
  }
  return out;
}

function validateLatLng(obj) {
  if (obj.latitude != null) {
    const lat = Number(obj.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, field: 'latitude' };
  }
  if (obj.longitude != null) {
    const lng = Number(obj.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, field: 'longitude' };
  }
  return { ok: true };
}

// List minimal fields for cards
/**
 * @openapi
 * tags:
 *   - name: Partners
 *     description: Gestione partner/fornitori
 */
/**
 * @openapi
 * /api/partner:
 *   get:
 *     summary: Lista partner (campi minimi)
 *     tags: [Partners]
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/', async (req, res) => {
  try {
    await ensurePartnerSchema();
    const pool = getPool();
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    // total count for pagination
    const [[cnt]] = await pool.query("SELECT COUNT(*) AS total FROM clienti_partner");
    const total = Number(cnt?.total || 0);
    const [rows] = await pool.query(
      "SELECT id, name, status, assign, domain, site, renew_date FROM clienti_partner ORDER BY id DESC LIMIT ? OFFSET ?",
      [limit, offset]
    );
    res.setHeader('X-Total-Count', String(total));
    res.json(rows);
  } catch (e) {
    try { (req?.log || console).warn('partner_list_failed', e?.message || String(e)); } catch {}
    res.status(500).json({ error: 'list_failed' });
  }
});

// Stats: total and active partners (status = 'attivo')
/**
 * @openapi
 * /api/partner/stats:
 *   get:
 *     summary: Statistiche partner (totale e attivi)
 *     tags: [Partners]
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/stats', async (_req, res) => {
  try {
    await ensurePartnerSchema();
    const pool = getPool();
    // Read statuses and count in JS to avoid collation/case pitfalls
    const [rows] = await pool.query("SELECT status FROM clienti_partner");
    const total = Array.isArray(rows) ? rows.length : 0;
    let active = 0;
    const by = { attivo: 0, configurazione: 0, sviluppo: 0, dismissione: 0 };
    for (const r of rows || []) {
      const s = (r.status ?? '').toString().trim().toLowerCase();
      if (s === 'attivo') active++;
      if (s in by) by[s]++;
    }
    res.json({ total, active, byStatus: by });
  } catch (e) {
    try { (_req?.log || console).warn('partner_stats_failed', e?.message || String(e)); } catch {}
    res.status(500).json({ error: 'stats_failed' });
  }
});

// Assign share for partners (clienti_partner)
// Returns { mine, others, total }
// NOTE: must be declared BEFORE '/:id' to avoid route shadowing
router.get('/assign-share', async (req, res) => {
  try {
    await ensurePartnerSchema();
    const username = (req.query.assign || '').toString().trim();
    const pool = getPool();
    const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM clienti_partner");
    let mine = 0;
    if (username) {
      const [[row]] = await pool.query("SELECT COUNT(*) AS c FROM clienti_partner WHERE assign = ?", [username]);
      mine = Number(row?.c || 0);
    }
    return res.json({ mine: Number(mine), others: Math.max(0, Number(total) - Number(mine)), total: Number(total) });
  } catch (e) {
    try { (req?.log || console).warn('partner_assign_share_failed', e?.message || String(e)); } catch {}
    return res.status(500).json({ error: 'assign_share_failed' });
  }
});

// Detail by id (full record)
/**
 * @openapi
 * /api/partner/{id}:
 *   get:
 *     summary: Dettaglio partner per id
 *     tags: [Partners]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200: { description: OK }
 *       404: { description: Non trovato }
 */
router.get('/:id', async (req, res) => {
  try {
    await ensurePartnerSchema();
    const id = Number(req.params.id);
    const pool = getPool();
    const [rows] = await pool.query("SELECT * FROM clienti_partner WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    try { req?.log?.info('partner_get_ok', { id }); } catch {}
    res.json(rows[0]);
  } catch (e) {
    try { (req?.log || console).warn('partner_get_failed', e?.message || String(e)); } catch {}
    res.status(500).json({ error: 'get_failed' });
  }
});

// Create partner
/**
 * @openapi
 * /api/partner:
 *   post:
 *     summary: Crea un partner
 *     tags: [Partners]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Creato }
 */
router.post('/', async (req, res) => {
  try {
    await ensurePartnerSchema();
    const data = pickData(req.body || {});
    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      return res.status(400).json({ error: 'name_required' });
    }
    const vr = validateLatLng(data);
    if (!vr.ok) return res.status(400).json({ error: 'invalid_coordinates', field: vr.field });
    const pool = getPool();
    const fields = Object.keys(data);
    const placeholders = fields.map(() => '?').join(',');
    const sql = `INSERT INTO clienti_partner (${fields.join(',')}) VALUES (${placeholders})`;
    const values = fields.map((k) => data[k]);
    const [r] = await pool.execute(sql, values);
    const id = r.insertId;
    const [rows] = await pool.query('SELECT * FROM clienti_partner WHERE id = ?', [id]);
    return res.status(201).json(rows[0]);
  } catch (e) {
    try { (req?.log || console).warn('partner_create_failed', e?.message || String(e)); } catch {}
    return res.status(500).json({ error: 'create_failed' });
  }
});

// Update partner (partial)
/**
 * @openapi
 * /api/partner/{id}:
 *   put:
 *     summary: Aggiorna un partner (parziale)
 *     tags: [Partners]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: OK }
 *       404: { description: Non trovato }
 */
router.put('/:id', async (req, res) => {
  try {
    await ensurePartnerSchema();
    const id = Number(req.params.id);
    const data = pickData(req.body || {});
    if (!id || !Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'no_fields' });
    const vr = validateLatLng(data);
    if (!vr.ok) return res.status(400).json({ error: 'invalid_coordinates', field: vr.field });
    const sets = Object.keys(data).map((k) => `${k} = ?`).join(', ');
    const values = Object.keys(data).map((k) => data[k]);
    const pool = getPool();
    const [r] = await pool.execute(`UPDATE clienti_partner SET ${sets} WHERE id = ?`, [...values, id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'not_found' });
    const [rows] = await pool.query('SELECT * FROM clienti_partner WHERE id = ?', [id]);
    return res.json(rows[0]);
  } catch (e) {
    try { (req?.log || console).warn('partner_update_failed', e?.message || String(e)); } catch {}
    return res.status(500).json({ error: 'update_failed' });
  }
});

// Delete partner
/**
 * @openapi
 * /api/partner/{id}:
 *   delete:
 *     summary: Elimina un partner
 *     tags: [Partners]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204: { description: Eliminato }
 *       404: { description: Non trovato }
 */
router.delete('/:id', async (req, res) => {
  try {
    await ensurePartnerSchema();
    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
    const pool = getPool();
    const [r] = await pool.execute('DELETE FROM clienti_partner WHERE id = ?', [id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'not_found' });
    return res.status(204).send();
  } catch (e) {
    try { (req?.log || console).warn('partner_delete_failed', e?.message || String(e)); } catch {}
    return res.status(500).json({ error: 'delete_failed' });
  }
});

// Export all partners as CSV
/**
 * @openapi
 * /api/partner/export:
 *   get:
 *     summary: Esporta tutti i partner in CSV
 *     tags: [Partners]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv] }
 *     responses:
 *       200:
 *         description: CSV
 */
router.get('/export', async (_req, res) => {
  try {
    await ensurePartnerSchema();
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM clienti_partner ORDER BY id ASC');
    const cols = ['id', ...FIELDS];
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [];
    lines.push(cols.join(','));
    for (const r of rows) {
      lines.push(cols.map((c) => esc(r[c])).join(','));
    }
    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="partner_export.csv"');
    res.end(csv);
  } catch (e) {
    try { console.warn('partner_export_failed', e?.message || String(e)); } catch {}
    res.status(500).json({ error: 'export_failed' });
  }
});

export default router;
