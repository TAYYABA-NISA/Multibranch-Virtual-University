import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { findClash } from '../clash.js';
import { validate, isDuplicate } from '../validate.js';

// Every route here works on the LOGGED-IN student only. The student comes from the login token,
// never from an id in the address, so one student can never read or change another's data.
const router = Router();

router.use((req, res, next) => {
  req.student = db.prepare('SELECT s.*, u.email FROM students s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?').get(req.user.id);
  req.student ? next() : res.status(403).json({ error: 'Students only' });
});

const slotsOf = db.prepare('SELECT id, course_id, date, start_time AS start, end_time AS end FROM exam_slots WHERE course_id = ? ORDER BY date, start_time');

router.get('/me', (req, res) => {
  const s = req.student;
  const courses = db.prepare(`SELECT c.id, c.code, c.title, c.credit_hours AS credits FROM student_courses sc
    JOIN courses c ON c.id = sc.course_id WHERE sc.student_id = ? ORDER BY c.code`).all(s.id).map(c => ({ ...c, slots: slotsOf.all(c.id) }));
  const saved = !!s.sheet_saved_at;
  const sheet = saved ? db.prepare(`SELECT c.id AS cid, c.code, c.title, c.credit_hours AS credits, e.id AS sid, e.date, e.start_time AS start, e.end_time AS end
      FROM selections x JOIN courses c ON c.id = x.course_id JOIN exam_slots e ON e.id = x.slot_id
      WHERE x.student_id = ? ORDER BY e.date, e.start_time`).all(s.id)
    .map(r => ({ course: { id: r.cid, code: r.code, title: r.title, credits: r.credits }, slot: { id: r.sid, date: r.date, start: r.start, end: r.end } })) : null;

  res.json({
    profile: {
      name: s.full_name, email: s.email, phone: s.phone, dob: s.dob, gender: s.gender,
      guardian: { name: s.guardian_name, occupation: s.guardian_occupation, phone: s.guardian_phone },
      academic: { reg: s.reg_no, program: s.program, semester: s.semester, batch: s.batch, cgpa: s.cgpa },
    },
    branch: db.prepare('SELECT id, name, code, city, address FROM branches WHERE id = ?').get(s.branch_id) || null,
    branches: db.prepare("SELECT id, name, code, city, address FROM branches WHERE status = 'active' ORDER BY name").all(),
    courses, sheet,
    sheetChoices: db.prepare('SELECT course_id, slot_id FROM selections WHERE student_id = ?').all(s.id),
    requests: db.prepare("SELECT id, type, reason, status, remark, substr(created_at, 1, 10) AS raised FROM requests WHERE student_id = ? ORDER BY id DESC").all(s.id),
    assignmentComplete: courses.length >= 4,
    canChooseBranch: !s.branch_id || !!s.branch_unlock,   // true the first time, or after the admin approves a change
    canEditSheet: !saved || !!s.sheet_unlock,
  });
});

// Choose the exam branch. Allowed once, or once more after an approved request.
router.post('/branch', validate(z.object({ branch_id: z.number().int() })), (req, res) => {
  const branch = db.prepare("SELECT id FROM branches WHERE id = ? AND status = 'active'").get(req.body.branch_id);
  if (!branch) return res.status(400).json({ error: 'Choose an active branch' });
  // One atomic statement: it only succeeds if the student has no branch yet, or has an unused unlock.
  const r = db.prepare('UPDATE students SET branch_id = ?, branch_unlock = 0 WHERE id = ? AND (branch_id IS NULL OR branch_unlock = 1)')
    .run(branch.id, req.student.id);
  if (!r.changes) return res.status(409).json({ error: 'Branch already selected. Ask the admin to approve a change.' });
  res.json({ ok: true });
});

const sheetSchema = z.object({ choices: z.array(z.object({ course_id: z.number().int(), slot_id: z.number().int() })) });

// Save the date sheet: all or nothing, once (or once more after an approved request).
router.post('/sheet', validate(sheetSchema), (req, res) => {
  const s = req.student, choices = req.body.choices;
  const assigned = db.prepare('SELECT course_id FROM student_courses WHERE student_id = ?').all(s.id).map(r => r.course_id);
  if (assigned.length < 4) return res.status(400).json({ error: 'Your course assignment is incomplete' });
  if (!s.branch_id) return res.status(400).json({ error: 'Choose your exam branch first' });
  if (s.sheet_saved_at && !s.sheet_unlock) return res.status(409).json({ error: 'Date sheet already saved. Ask the admin to approve a change.' });

  if (choices.length !== assigned.length || assigned.some(id => !choices.find(c => c.course_id === id)))
    return res.status(400).json({ error: 'Pick a slot for every course' });

  // Each slot must exist AND belong to the course it was picked for.
  const slots = choices.map(c => db.prepare(`SELECT e.*, co.code FROM exam_slots e JOIN courses co ON co.id = e.course_id
    WHERE e.id = ? AND e.course_id = ?`).get(c.slot_id, c.course_id));
  if (slots.some(x => !x)) return res.status(400).json({ error: 'Invalid slot choice' });
  const clash = findClash(slots);
  if (clash) return res.status(400).json({ error: clash });

  try {
  db.transaction(() => {
    const lock = db.prepare("UPDATE students SET sheet_saved_at = datetime('now'), sheet_unlock = 0 WHERE id = ? AND (sheet_saved_at IS NULL OR sheet_unlock = 1)").run(s.id);
    if (!lock.changes) throw Object.assign(new Error('locked'), { status: 409 });
    db.prepare('DELETE FROM selections WHERE student_id = ?').run(s.id);
    for (const c of choices) db.prepare('INSERT INTO selections (student_id, course_id, slot_id) VALUES (?, ?, ?)').run(s.id, c.course_id, c.slot_id);
  })();
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: 'Date sheet already saved. Ask the admin to approve a change.' });
    throw err;
  }
  res.json({ ok: true });
});

router.post('/requests', validate(z.object({ type: z.enum(['branch', 'sheet']), reason: z.string().trim().min(5, 'please explain in a few words').max(500) })), (req, res) => {
  try {
    db.prepare('INSERT INTO requests (student_id, type, reason) VALUES (?, ?, ?)').run(req.student.id, req.body.type, req.body.reason);
    res.status(201).json({ ok: true });
  } catch (err) {
    // The database's "one pending request per student and type" index refuses the duplicate.
    if (isDuplicate(err)) return res.status(409).json({ error: 'You already have a pending request of this type' });
    throw err;
  }
});

export default router;
