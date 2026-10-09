import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { pageParams, pageResult, clampPage, likeTerm } from '../paging.js';
import { validate } from '../validate.js';

const router = Router();

// GET /api/admin/requests?status=pending&type=sheet&search=ayesha&page=1&size=10
router.get('/', (req, res) => {
  const where = [`(s.full_name LIKE @t ESCAPE '\\' OR r.reason LIKE @t ESCAPE '\\')`];
  const params = { t: likeTerm(req.query.search) };
  if (['pending', 'approved', 'rejected'].includes(req.query.status)) { where.push('r.status = @status'); params.status = req.query.status; }
  if (['branch', 'sheet'].includes(req.query.type)) { where.push('r.type = @type'); params.type = req.query.type; }
  const from = `FROM requests r JOIN students s ON s.id = r.student_id WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(params).n;
  const pg = clampPage(pageParams(req.query), total);
  const items = db.prepare(`SELECT r.id, s.full_name AS student_name, r.type, r.reason, substr(r.created_at, 1, 10) AS raised, r.status, COALESCE(r.remark, '') AS remark
    ${from} ORDER BY (r.status = 'pending') DESC, r.id DESC LIMIT @size OFFSET @offset`).all({ ...params, size: pg.size, offset: pg.offset });
  res.json(pageResult(items, total, pg));
});

// Approve or reject. Approving switches on a ONE-TIME unlock for that student; using it switches it off again.
router.post('/:id/decide', validate(z.object({ status: z.enum(['approved', 'rejected']), remark: z.string().trim().max(300).optional().default('') })), (req, res) => {
  const result = db.transaction(() => {
    const r = db.prepare("UPDATE requests SET status = ?, remark = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'")
      .run(req.body.status, req.body.remark, req.params.id);
    if (!r.changes) return false;
    if (req.body.status === 'approved') {
      const request = db.prepare('SELECT student_id, type FROM requests WHERE id = ?').get(req.params.id);
      const column = request.type === 'branch' ? 'branch_unlock' : 'sheet_unlock'; // fixed list, never user text
      db.prepare(`UPDATE students SET ${column} = 1 WHERE id = ?`).run(request.student_id);
    }
    return true;
  })();
  result ? res.json({ ok: true }) : res.status(409).json({ error: 'Request not found or already decided' });
});

export default router;
