import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { pageParams, pageResult, likeTerm } from '../paging.js';
import { validate, isDuplicate } from '../validate.js';

// The pattern every admin list follows: validate input, query ONE page, return items + total.
const router = Router();

const branchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().toUpperCase().min(2).max(10),
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().min(3).max(200),
  phone: z.string().trim().max(30).optional().default(''),
  status: z.enum(['active', 'inactive']).default('active'),
});

// List: GET /api/admin/branches?search=lah&status=active&page=1&size=10
router.get('/', (req, res) => {
  const pg = pageParams(req.query);
  const where = ['(b.name LIKE @term ESCAPE \'\\\' OR b.code LIKE @term ESCAPE \'\\\' OR b.city LIKE @term ESCAPE \'\\\')'];
  const params = { term: likeTerm(req.query.search) };
  if (['active', 'inactive'].includes(req.query.status)) { where.push('b.status = @status'); params.status = req.query.status; }
  const clause = 'WHERE ' + where.join(' AND ');

  // The total counts only the filtered rows, so the page counter is right while searching.
  const total = db.prepare(`SELECT COUNT(*) AS n FROM branches b ${clause}`).get(params).n;
  const items = db.prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM students s WHERE s.branch_id = b.id) AS student_count
    FROM branches b ${clause} ORDER BY b.name LIMIT @size OFFSET @offset`).all({ ...params, size: pg.size, offset: pg.offset });
  res.json(pageResult(items, total, pg));
});

router.get('/:id', (req, res) => {
  const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  branch ? res.json(branch) : res.status(404).json({ error: 'Branch not found' });
});

router.post('/', validate(branchSchema), (req, res) => {
  try {
    const b = req.body;
    const id = db.prepare('INSERT INTO branches (name, code, city, address, phone, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(b.name, b.code, b.city, b.address, b.phone, b.status).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM branches WHERE id = ?').get(id));
  } catch (err) {
    if (isDuplicate(err)) return res.status(409).json({ error: `Branch code ${req.body.code} is already used` });
    throw err;
  }
});

router.put('/:id', validate(branchSchema), (req, res) => {
  try {
    const b = req.body;
    const r = db.prepare('UPDATE branches SET name = ?, code = ?, city = ?, address = ?, phone = ?, status = ? WHERE id = ?')
      .run(b.name, b.code, b.city, b.address, b.phone, b.status, req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Branch not found' });
    res.json(db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id));
  } catch (err) {
    if (isDuplicate(err)) return res.status(409).json({ error: `Branch code ${req.body.code} is already used` });
    throw err;
  }
});

// SAFE DELETE: a branch that students have chosen is never removed. We block the delete and
// tell the admin to mark it inactive, so existing date sheets still show the right branch.
router.delete('/:id', (req, res) => {
  const inUse = db.prepare('SELECT COUNT(*) AS n FROM students WHERE branch_id = ?').get(req.params.id).n;
  if (inUse) return res.status(409).json({ error: `${inUse} student(s) chose this branch, so it cannot be deleted. Mark it inactive instead.`, student_count: inUse });
  const r = db.prepare('DELETE FROM branches WHERE id = ?').run(req.params.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Branch not found' });
});

export default router;
