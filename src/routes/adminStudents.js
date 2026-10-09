import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { pageParams, pageResult, clampPage, likeTerm } from '../paging.js';
import { validate, isDuplicate } from '../validate.js';

const router = Router();

// List with search, filters and server-side pages.
router.get('/', (req, res) => {
  const like = `LIKE @t ESCAPE '\\'`;
  const where = [`(s.full_name ${like} OR u.email ${like} OR s.reg_no ${like})`];
  const params = { t: likeTerm(req.query.search) };
  if (req.query.assignment === 'incomplete') where.push('(SELECT COUNT(*) FROM student_courses c WHERE c.student_id = s.id) < 4');
  if (req.query.sheet === 'saved') where.push('s.sheet_saved_at IS NOT NULL');
  if (req.query.sheet === 'not_saved') where.push('s.sheet_saved_at IS NULL');
  const from = `FROM students s JOIN users u ON u.id = s.user_id LEFT JOIN branches b ON b.id = s.branch_id WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(params).n;
  const pg = clampPage(pageParams(req.query), total);
  const items = db.prepare(`SELECT s.id, s.full_name AS name, u.email, s.reg_no AS reg, s.program, s.semester,
      (SELECT COUNT(*) FROM student_courses c WHERE c.student_id = s.id) AS course_count,
      COALESCE(b.name, 'Not chosen') AS branch,
      CASE WHEN s.sheet_saved_at IS NULL THEN 'Not saved' ELSE 'Saved' END AS sheet
    ${from} ORDER BY s.full_name LIMIT @size OFFSET @offset`).all({ ...params, size: pg.size, offset: pg.offset });
  res.json(pageResult(items, total, pg));
});

const studentOf = (id) => db.prepare('SELECT * FROM students WHERE id = ?').get(id);
const courseCols = 'c.id, c.code, c.title, c.credit_hours AS credits';

router.get('/:id', (req, res) => {
  const s = studentOf(req.params.id);
  if (!s) return res.status(404).json({ error: 'Student not found' });
  res.json({
    student: { id: s.id, name: s.full_name, reg: s.reg_no, program: s.program, semester: s.semester },
    assigned: db.prepare(`SELECT ${courseCols} FROM student_courses sc JOIN courses c ON c.id = sc.course_id WHERE sc.student_id = ? ORDER BY c.code`).all(s.id),
    available: db.prepare(`SELECT ${courseCols} FROM courses c WHERE c.status = 'active' AND c.id NOT IN (SELECT course_id FROM student_courses WHERE student_id = ?) ORDER BY c.code`).all(s.id),
    locked: !!s.sheet_saved_at,
  });
});

const lockedMessage = 'This student has saved a date sheet. Approve a change request first.';
const courseBody = z.object({ course_id: z.number().int() });

// The 4 to 6 rule is enforced HERE. The maximum is checked on every assign; the minimum shows as
// "assignment incomplete" and blocks the student from picking dates.
router.post('/:id/assign', validate(courseBody), (req, res) => {
  const s = studentOf(req.params.id);
  if (!s) return res.status(404).json({ error: 'Student not found' });
  if (s.sheet_saved_at) return res.status(409).json({ error: lockedMessage });
  if (!db.prepare("SELECT 1 FROM courses WHERE id = ? AND status = 'active'").get(req.body.course_id)) return res.status(404).json({ error: 'Course not found' });
  try {
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM student_courses WHERE student_id = ? AND course_id = ?').get(s.id, req.body.course_id)) throw Object.assign(new Error('dup'), { status: 409 });
      if (db.prepare('SELECT COUNT(*) AS n FROM student_courses WHERE student_id = ?').get(s.id).n >= 6) throw Object.assign(new Error('max'), { status: 400 });
      db.prepare('INSERT INTO student_courses (student_id, course_id) VALUES (?, ?)').run(s.id, req.body.course_id);
    })();
    res.json({ ok: true });
  } catch (err) {
    if (isDuplicate(err) || err.status === 409) return res.status(409).json({ error: 'Course already assigned to this student' });
    if (err.status === 400) return res.status(400).json({ error: 'A student can have at most 6 courses' });
    throw err;
  }
});

router.post('/:id/unassign', validate(courseBody), (req, res) => {
  const s = studentOf(req.params.id);
  if (!s) return res.status(404).json({ error: 'Student not found' });
  if (s.sheet_saved_at) return res.status(409).json({ error: lockedMessage });
  db.prepare('DELETE FROM student_courses WHERE student_id = ? AND course_id = ?').run(s.id, req.body.course_id);
  res.json({ ok: true });
});

export default router;
