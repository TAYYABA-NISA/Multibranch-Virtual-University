import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { pageParams, pageResult, clampPage, likeTerm } from '../paging.js';
import { validate, isDuplicate } from '../validate.js';
import { sendPasswordEmail } from '../auth.js';

const router = Router();
const studentSchema = z.object({
  full_name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(30).optional().default(''),
  cnic: z.string().trim().max(20).optional().default(''),
  dob: z.string().trim().max(10).optional().default(''),
  gender: z.string().trim().max(30).optional().default(''),
  address: z.string().trim().max(250).optional().default(''),
  guardian_name: z.string().trim().max(100).optional().default(''),
  guardian_cnic: z.string().trim().max(20).optional().default(''),
  guardian_occupation: z.string().trim().max(80).optional().default(''),
  guardian_phone: z.string().trim().max(30).optional().default(''),
  emergency_contact: z.string().trim().max(30).optional().default(''),
  reg_no: z.string().trim().toUpperCase().min(2).max(40),
  program: z.string().trim().min(2).max(100),
  semester: z.number().int().min(1).max(20),
  batch: z.string().trim().max(20).optional().default(''),
  prev_qualification: z.string().trim().max(100).optional().default(''),
  prev_institute: z.string().trim().max(120).optional().default(''),
  cgpa: z.number().min(0).max(4).nullable().optional().default(null),
});
const studentFields = `full_name, phone, cnic, dob, gender, address, guardian_name,
  guardian_cnic, guardian_occupation, guardian_phone, emergency_contact, reg_no,
  program, semester, batch, prev_qualification, prev_institute, cgpa`;

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
  const email = db.prepare('SELECT email FROM users WHERE id = ?').get(s.user_id).email;
  res.json({
    student: { ...s, id: s.id, email, name: s.full_name, reg: s.reg_no },
    assigned: db.prepare(`SELECT ${courseCols} FROM student_courses sc JOIN courses c ON c.id = sc.course_id WHERE sc.student_id = ? ORDER BY c.code`).all(s.id),
    available: db.prepare(`SELECT ${courseCols} FROM courses c WHERE c.status = 'active' AND c.id NOT IN (SELECT course_id FROM student_courses WHERE student_id = ?) ORDER BY c.code`).all(s.id),
    locked: !!s.sheet_saved_at && !s.sheet_unlock,
  });
});

router.post('/', validate(studentSchema), async (req, res) => {
  const s = req.body;
  let studentId, userId;
  try {
    db.transaction(() => {
      userId = db.prepare("INSERT INTO users (email, role) VALUES (?, 'student')").run(s.email).lastInsertRowid;
      studentId = db.prepare(`INSERT INTO students (user_id, ${studentFields})
        VALUES (?, ${studentFields.split(',').map(() => '?').join(', ')})`)
        .run(userId, ...studentFields.split(',').map((field) => s[field.trim()])).lastInsertRowid;
    })();
  } catch (err) {
    if (isDuplicate(err)) return res.status(409).json({ error: 'That email or registration number is already in use' });
    throw err;
  }
  const student = studentOf(studentId);
  try {
    await sendPasswordEmail({ id: userId, email: s.email }, 'welcome');
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'Student created, but the setup email could not be sent. Use Resend setup email.', student: { id: studentId } });
  }
  res.status(201).json({ id: student.id, name: student.full_name, email: s.email, reg: student.reg_no });
});

router.put('/:id', validate(studentSchema), (req, res) => {
  const s = studentOf(req.params.id);
  if (!s) return res.status(404).json({ error: 'Student not found' });
  const values = req.body;
  try {
    db.transaction(() => {
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(values.email, s.user_id);
      db.prepare(`UPDATE students SET ${studentFields.split(',').map((field) => `${field.trim()} = ?`).join(', ')} WHERE id = ?`)
        .run(...studentFields.split(',').map((field) => values[field.trim()]), s.id);
    })();
  } catch (err) {
    if (isDuplicate(err)) return res.status(409).json({ error: 'That email or registration number is already in use' });
    throw err;
  }
  res.json({ ok: true });
});

router.post('/:id/setup-email', async (req, res, next) => {
  const s = studentOf(req.params.id);
  if (!s) return res.status(404).json({ error: 'Student not found' });
  const account = db.prepare('SELECT id, email FROM users WHERE id = ?').get(s.user_id);
  try {
    await sendPasswordEmail(account, 'welcome');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', (req, res) => {
  const s = studentOf(req.params.id);
  if (!s) return res.status(404).json({ error: 'Student not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(s.user_id);
  })();
  res.json({ ok: true });
});

const lockedMessage = 'This student has saved a date sheet. Approve a change request first.';
const courseBody = z.object({ course_id: z.number().int() });

// The 4 to 6 rule is enforced HERE. The maximum is checked on every assign; the minimum shows as
// "assignment incomplete" and blocks the student from picking dates.
router.post('/:id/assign', validate(courseBody), (req, res) => {
  const s = studentOf(req.params.id);
  if (!s) return res.status(404).json({ error: 'Student not found' });
  if (s.sheet_saved_at && !s.sheet_unlock) return res.status(409).json({ error: lockedMessage });
  if (!db.prepare("SELECT 1 FROM courses WHERE id = ? AND status = 'active'").get(req.body.course_id)) return res.status(404).json({ error: 'Course not found' });
  try {
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM student_courses WHERE student_id = ? AND course_id = ?').get(s.id, req.body.course_id)) throw Object.assign(new Error('dup'), { status: 409 });
      if (db.prepare('SELECT COUNT(*) AS n FROM student_courses WHERE student_id = ?').get(s.id).n >= 6) throw Object.assign(new Error('max'), { status: 400 });
      db.prepare('INSERT INTO student_courses (student_id, course_id) VALUES (?, ?)').run(s.id, req.body.course_id);
      if (s.sheet_unlock) db.prepare('UPDATE students SET sheet_unlock = 0 WHERE id = ?').run(s.id);
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
  if (s.sheet_saved_at && !s.sheet_unlock) return res.status(409).json({ error: lockedMessage });
  db.transaction(() => {
    db.prepare('DELETE FROM student_courses WHERE student_id = ? AND course_id = ?').run(s.id, req.body.course_id);
    if (s.sheet_unlock) db.prepare('UPDATE students SET sheet_unlock = 0 WHERE id = ?').run(s.id);
  })();
  res.json({ ok: true });
});

export default router;
