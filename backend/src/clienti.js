import { Router } from "express";
import { getPool } from "./db.js";
import { cacheGet, cacheSet, cacheDelPrefix, stableKeyFromQuery } from './cache.js';

const router = Router();

// Column list for insert/update
const columns = [
  "name","site","city","category",
  "email_1","email_2","email_3",
  "phone_1","phone_2","phone_3",
  "latitude","longitude",
  "assign","contact_method",
  "data_start","data_follow_up_1","data_follow_up_2",
  "status","note"
];

function pickData(body) {
  const obj = {};
  for (const c of columns) {
    if (body[c] !== undefined) obj[c] = body[c];
  }
  return obj;
}

/**
 * @openapi
 * tags:
 *   - name: Clienti
 *     description: Gestione anagrafiche clienti
 */
// List with optional query params: q (search by name/city/category), limit, offset
/**
 * @openapi
 * /api/clienti:
 *   get:
 *     summary: Lista clienti (paginata)
 *     tags: [Clienti]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0 }
 *     responses:
 *       200: { description: OK }
 */
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const q = (req.query.q || "").toString().trim();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    // Select only the columns needed by the UI to reduce payload
    let sql = "SELECT id, name, city, category, status FROM clienti";
    const params = [];
    if (q) {
      sql += " WHERE name LIKE ? OR city LIKE ? OR category LIKE ?";
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "list_failed" });
  }
});

// Distinct filters for cities, categories, statuses (place before :id route)
/**
 * @openapi
 * /api/clienti/filters:
 *   get:
 *     summary: Valori distinti per filtri
 *     tags: [Clienti]
 *     parameters:
 *       - in: query
 *         name: assign
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 */
router.get("/filters", async (req, res) => {
  const parseMulti = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v.flatMap((s) => s.split(',').map((x) => x.trim()).filter(Boolean));
    return v.toString().split(',').map((x) => x.trim()).filter(Boolean);
  };
  const assigns = parseMulti(req.query.assign);

  const cacheKey = 'clienti:filters:' + stableKeyFromQuery({ assign: assigns });
  const hit = await cacheGet(cacheKey);
  if (hit) { res.setHeader('X-Cache', 'HIT'); return res.json(hit); }

  const pool = getPool();
  const params = [];
  const where = [];
  if (assigns.length) { where.push(`assign IN (${assigns.map(()=>'?').join(',')})`); params.push(...assigns); }
  const baseWhere = where.length ? (' WHERE ' + where.join(' AND ')) : '';

  const citySql = `SELECT DISTINCT TRIM(\`city\`) AS city FROM \`clienti\`${baseWhere}${baseWhere ? ' AND ' : ' WHERE '}TRIM(\`city\`) <> '' ORDER BY 1`;
  const catSql = `SELECT DISTINCT TRIM(\`category\`) AS category FROM \`clienti\`${baseWhere}${baseWhere ? ' AND ' : ' WHERE '}TRIM(\`category\`) <> '' ORDER BY 1`;
  const [cityRows] = await pool.query(citySql, params);
  const [categoryRows] = await pool.query(catSql, params);
  const cities = cityRows.map((r) => r.city).filter(Boolean);
  const categories = categoryRows.map((r) => r.category).filter(Boolean);
  const statuses = [ 'Non contattato', 'Contattato', 'Primo follow up', 'Secondo follow up', 'Scartato' ];
  const payload = { cities, categories, statuses };
  await cacheSet(cacheKey, payload, 600);
  res.setHeader('X-Cache', 'MISS');
  res.json(payload);
});

// Export all clienti as CSV with optional filters and sorting
// Accepts same query params used by clients-to-call page
router.get('/export', async (req, res) => {
  try {
    const pool = getPool();

    // Parse filters
    const q = (req.query.q || '').toString().trim();
    const parseList = (v) => Array.isArray(v)
      ? v.flatMap((s)=> s.split(',')).map((x)=> x.trim()).filter(Boolean)
      : (v ? v.toString().split(',').map((x)=> x.trim()).filter(Boolean) : []);
    const cities = parseList(req.query.city);
    const categories = parseList(req.query.category);
    const statuses = parseList(req.query.status);
    const assigns = parseList(req.query.assign);
    const sort = ['id','name','city','category','status','assign'].includes((req.query.sort||'').toString()) ? (req.query.sort||'name').toString() : 'name';
    const dir = ((req.query.dir||'asc').toString().toLowerCase() === 'desc') ? 'DESC' : 'ASC';

    const where = [];
    const params = [];
    if (q) { where.push('(name LIKE ? OR city LIKE ? OR category LIKE ?)'); const like = `%${q}%`; params.push(like, like, like); }
    if (cities.length) { where.push(`city IN (${cities.map(()=>'?').join(',')})`); params.push(...cities); }
    if (categories.length) { where.push(`category IN (${categories.map(()=>'?').join(',')})`); params.push(...categories); }
    if (statuses.length) { where.push(`status IN (${statuses.map(()=>'?').join(',')})`); params.push(...statuses); }
    if (assigns.length) { where.push(`assign IN (${assigns.map(()=>'?').join(',')})`); params.push(...assigns); }
    const whereSql = where.length ? (' WHERE ' + where.join(' AND ')) : '';

    const columns = ['id','name','site','city','category','email_1','email_2','email_3','phone_1','phone_2','phone_3','latitude','longitude','assign','contact_method','data_start','data_follow_up_1','data_follow_up_2','status','note'];

    // CSV helpers
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clienti_export.csv"');

    // Write header
    res.write(columns.join(',') + '\n');

    const pageSize = 1000;
    let offset = 0;
    // Paginate server-side to avoid large memory usage
    // Keep ordering stable
    const orderSql = ` ORDER BY ${sort} ${dir}`;
    while (true) {
      const sql = `SELECT ${columns.join(', ')} FROM clienti${whereSql}${orderSql} LIMIT ${pageSize} OFFSET ${offset}`;
      const [rows] = await pool.query(sql, params);
      if (!rows.length) break;
      for (const r of rows) {
        res.write(columns.map((c)=> esc(r[c])).join(',') + '\n');
      }
      offset += rows.length;
      if (rows.length < pageSize) break;
    }
    res.end();
  } catch (e) {
    try { console.error('clienti_export_failed', e?.message || String(e)); } catch {}
    res.status(500).json({ error: 'export_failed', detail: e?.message || String(e) });
  }
});

// Get by id
/**
 * @openapi
 * /api/clienti/{id}:
 *   get:
 *     summary: Dettaglio cliente
 *     tags: [Clienti]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Non trovato }
 */
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    const hit = await cacheGet(`clienti:id:${id}`);
    if (hit) { res.setHeader('X-Cache', 'HIT'); return res.json(hit); }
    const [rows] = await pool.query("SELECT * FROM clienti WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    await cacheSet(`clienti:id:${id}`, rows[0], 300);
    res.setHeader('X-Cache', 'MISS');
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "get_failed" });
  }
});

// Create
/**
 * @openapi
 * /api/clienti:
 *   post:
 *     summary: Crea cliente
 *     tags: [Clienti]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       201: { description: Creato }
 */
router.post("/", async (req, res) => {
  try {
    const pool = getPool();
    const data = pickData(req.body || {});
    if (!data.name || typeof data.name !== "string") {
      return res.status(400).json({ error: "name_required" });
    }
    const fields = Object.keys(data);
    const placeholders = fields.map(() => "?").join(",");
    const sql = `INSERT INTO clienti (${fields.join(",")}) VALUES (${placeholders})`;
    const values = fields.map((k) => data[k]);
    const [result] = await pool.execute(sql, values);
    const insertedId = result.insertId;
    const [rows] = await pool.query("SELECT * FROM clienti WHERE id = ?", [insertedId]);
    // Invalidate caches affected by changes (fire-and-forget)
    cacheDelPrefix('clienti-da-chiamare').catch(()=>{});
    cacheDelPrefix('clienti:filters').catch(()=>{});
    cacheDelPrefix('contacts-by-status').catch(()=>{});
    cacheDelPrefix('assign-share').catch(()=>{});
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "create_failed" });
  }
});

// Update (partial)
/**
 * @openapi
 * /api/clienti/{id}:
 *   put:
 *     summary: Aggiorna cliente (parziale)
 *     tags: [Clienti]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Non trovato }
 */
router.put("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    const data = pickData(req.body || {});
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "no_fields" });
    }
    const sets = Object.keys(data).map((k) => `${k} = ?`).join(", ");
    const values = Object.keys(data).map((k) => data[k]);
    const [r] = await pool.execute(`UPDATE clienti SET ${sets} WHERE id = ?`, [...values, id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: "not_found" });
    const [rows] = await pool.query("SELECT * FROM clienti WHERE id = ?", [id]);
    // Invalidate caches (non-blocking)
    cacheDelPrefix('clienti-da-chiamare').catch(()=>{});
    cacheDelPrefix('clienti:filters').catch(()=>{});
    cacheDelPrefix('contacts-by-status').catch(()=>{});
    cacheDelPrefix('assign-share').catch(()=>{});
    cacheDelPrefix(`clienti:id:${id}`).catch(()=>{});
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "update_failed" });
  }
});

// Delete
/**
 * @openapi
 * /api/clienti/{id}:
 *   delete:
 *     summary: Elimina cliente
 *     tags: [Clienti]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204: { description: Eliminato }
 *       404: { description: Non trovato }
 */
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    const [r] = await pool.execute("DELETE FROM clienti WHERE id = ?", [id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: "not_found" });
    // Invalidate caches (non-blocking)
    cacheDelPrefix('clienti-da-chiamare').catch(()=>{});
    cacheDelPrefix('clienti:filters').catch(()=>{});
    cacheDelPrefix('contacts-by-status').catch(()=>{});
    cacheDelPrefix('assign-share').catch(()=>{});
    cacheDelPrefix(`clienti:id:${id}`).catch(()=>{});
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: "delete_failed" });
  }
});


export default router;

// Batch import clienti
// Expects body: { items: Array<Partial<columns>> }
// Accepts only known columns; requires name string for each item
/**
 * @openapi
 * /api/clienti/batch:
 *   post:
 *     summary: Import batch clienti
 *     tags: [Clienti]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200: { description: OK }
 */
router.post("/batch", async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) return res.status(400).json({ error: "invalid_payload" });
    if (items.length === 0) return res.json({ inserted: 0, failed: 0, errors: [] });
    if (items.length > 2000) return res.status(400).json({ error: "too_many_items", max: 2000 });

    const pool = getPool();
    let inserted = 0;
    const errors = [];
    for (let i = 0; i < items.length; i++) {
      const raw = items[i] || {};
      const data = pickData(raw);
      if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
        errors.push({ index: i, code: 'name_required' });
        continue;
      }
      try {
        const fields = Object.keys(data);
        const placeholders = fields.map(() => '?').join(',');
        const sql = `INSERT INTO clienti (${fields.join(',')}) VALUES (${placeholders})`;
        const values = fields.map((k) => data[k]);
        await pool.execute(sql, values);
        inserted++;
      } catch (e) {
        errors.push({ index: i, code: 'insert_failed' });
      }
    }

    // Invalidate caches affected by changes (non-blocking)
    cacheDelPrefix('clienti-da-chiamare').catch(()=>{});
    cacheDelPrefix('clienti:filters').catch(()=>{});
    cacheDelPrefix('contacts-by-status').catch(()=>{});
    cacheDelPrefix('assign-share').catch(()=>{});

    res.json({ inserted, failed: errors.length, errors });
  } catch (e) {
    res.status(500).json({ error: "batch_failed" });
  }
});
