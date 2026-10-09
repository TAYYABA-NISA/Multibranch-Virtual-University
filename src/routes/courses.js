import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { pageParams, pageResult, likeTerm } from '../paging.js';
import { validate, isDuplicate } from '../validate.js';

const router = Router();
const courseSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(20),
  title: z.string().trim().min(2).max(120),
  credit_hours: z.number().int().min(1).max(6),
  department: z.string().trim().max(80).optional().default(''),
  status: z.enum(['active', 'inactive']).default('active'),
});

router.get('/', (req, res) => {
  const pg = pageParams(req.query);
  const term = likeTerm(req.query.search);
  const where = ['(code LIKE @term ESCAPE \'\\\' OR title LIKE @term ESCAPE \'\\\' OR department LIKE @term ESCAPE \'\\\')'];
  const params = { term };
  if (['active', 'inactive'].includes(req.query.status)) {
    where.push('status = @status');
    params.status = req.query.status;
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM courses ${clause}`).get(params).n;
  const items = db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM student_courses sc WHERE sc.course_id = c.id) AS student_count,
      (SELECT COUNT(*) FROM exam_slots e WHERE e.course_id = c.id) AS slot_count
    FROM courses c ${clause} ORDER BY c.code LIMIT @size OFFSET @offset`)
    .all({ ...params, size: pg.size, offset: pg.offset });
  res.json(pageResult(items, total, pg));
});

router.get('/:id', (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  course ? res.json(course) : res.status(404).json({ error: 'Course not found' });
});

router.post('/', validate(courseSchema), (req, res) => {
  try {
    const c = req.body;
    const id = db.prepare('INSERT INTO courses (code, title, credit_hours, department, status) VALUES (?, ?, ?, ?, ?)')
      .run(c.code, c.title, c.credit_hours, c.department, c.status).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM courses WHERE id = ?').get(id));
  } catch (err) {
    if (isDuplicate(err)) return res.status(409).json({ error: `Course code ${req.body.code} is already used` });
    throw err;
  }
});

router.put('/:id', validate(courseSchema), (req, res) => {
  try {
    const c = req.body;
    const result = db.prepare('UPDATE courses SET code = ?, title = ?, credit_hours = ?, department = ?, status = ? WHERE id = ?')
      .run(c.code, c.title, c.credit_hours, c.department, c.status, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Course not found' });
    res.json(db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id));
  } catch (err) {
    if (isDuplicate(err)) return res.status(409).json({ error: `Course code ${req.body.code} is already used` });
    throw err;
  }
});

router.delete('/:id', (req, res) => {
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM student_courses WHERE course_id = ?) AS students,
      (SELECT COUNT(*) FROM exam_slots WHERE course_id = ?) AS slots,
      (SELECT COUNT(*) FROM selections WHERE course_id = ?) AS selections`)
    .get(req.params.id, req.params.id, req.params.id);
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Course not found' });
  if (counts.students || counts.slots || counts.selections) {
    return res.status(409).json({
      error: `This course is in use by ${counts.students} student assignment(s) and ${counts.slots} exam slot(s). Mark it inactive instead.`,
      ...counts,
    });
  }
  db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
