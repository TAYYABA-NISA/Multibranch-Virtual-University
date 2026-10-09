import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { overlaps } from '../clash.js';
import { pageParams, pageResult, likeTerm } from '../paging.js';
import { validate, isDuplicate } from '../validate.js';

const router = Router();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must use HH:MM time');
const slotSchema = z.object({
  course_id: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must use YYYY-MM-DD').refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'must be a real calendar date'),
  start_time: time,
  end_time: time,
}).refine((value) => value.end_time > value.start_time, {
  path: ['end_time'],
  message: 'must be after start time',
});

function conflictFor(slot, excludeId) {
  const existing = db.prepare(`SELECT e.id, e.date, e.start_time, e.end_time, c.code
    FROM exam_slots e JOIN courses c ON c.id = e.course_id
    WHERE e.date = ? AND (? IS NULL OR e.id != ?)`).all(slot.date, excludeId ?? null, excludeId ?? null);
  const conflict = existing.find((candidate) => overlaps(slot, candidate));
  return conflict || null;
}

router.get('/', (req, res) => {
  const pg = pageParams(req.query);
  const params = { term: likeTerm(req.query.search) };
  const where = ['(c.code LIKE @term ESCAPE \'\\\' OR c.title LIKE @term ESCAPE \'\\\')'];
  if (Number.isInteger(Number(req.query.course_id)) && Number(req.query.course_id) > 0) {
    where.push('e.course_id = @course_id');
    params.course_id = Number(req.query.course_id);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const from = `FROM exam_slots e JOIN courses c ON c.id = e.course_id ${clause}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(params).n;
  const items = db.prepare(`SELECT e.id, e.course_id, c.code, c.title, e.date,
      e.start_time, e.end_time,
      (SELECT COUNT(*) FROM selections x WHERE x.slot_id = e.id) AS selected_count
    ${from} ORDER BY e.date, e.start_time, c.code LIMIT @size OFFSET @offset`)
    .all({ ...params, size: pg.size, offset: pg.offset });
  res.json(pageResult(items, total, pg));
});

router.get('/:id', (req, res) => {
  const slot = db.prepare(`SELECT e.*, c.code, c.title FROM exam_slots e
    JOIN courses c ON c.id = e.course_id WHERE e.id = ?`).get(req.params.id);
  slot ? res.json(slot) : res.status(404).json({ error: 'Exam slot not found' });
});

router.post('/', validate(slotSchema), (req, res) => {
  const slot = req.body;
  if (!db.prepare("SELECT 1 FROM courses WHERE id = ? AND status = 'active'").get(slot.course_id)) {
    return res.status(404).json({ error: 'Active course not found' });
  }
  const conflict = conflictFor(slot);
  if (conflict) return res.status(409).json({ error: `This slot overlaps ${conflict.code} on the same date.` });
  try {
    const id = db.prepare('INSERT INTO exam_slots (course_id, date, start_time, end_time) VALUES (?, ?, ?, ?)')
      .run(slot.course_id, slot.date, slot.start_time, slot.end_time).lastInsertRowid;
    res.status(201).json(db.prepare(`SELECT e.*, c.code, c.title FROM exam_slots e
      JOIN courses c ON c.id = e.course_id WHERE e.id = ?`).get(id));
  } catch (err) {
    if (isDuplicate(err)) return res.status(409).json({ error: 'A slot for this course already exists at that date and start time' });
    throw err;
  }
});

router.put('/:id', validate(slotSchema), (req, res) => {
  const existing = db.prepare('SELECT * FROM exam_slots WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Exam slot not found' });
  const selected = db.prepare('SELECT COUNT(*) AS n FROM selections WHERE slot_id = ?').get(existing.id).n;
  if (selected) return res.status(409).json({ error: 'This slot is already selected by a student and cannot be edited.', selected_count: selected });
  const slot = req.body;
  if (!db.prepare("SELECT 1 FROM courses WHERE id = ? AND status = 'active'").get(slot.course_id)) {
    return res.status(404).json({ error: 'Active course not found' });
  }
  const conflict = conflictFor(slot, existing.id);
  if (conflict) return res.status(409).json({ error: `This slot overlaps ${conflict.code} on the same date.` });
  try {
    db.prepare('UPDATE exam_slots SET course_id = ?, date = ?, start_time = ?, end_time = ? WHERE id = ?')
      .run(slot.course_id, slot.date, slot.start_time, slot.end_time, existing.id);
    res.json(db.prepare(`SELECT e.*, c.code, c.title FROM exam_slots e
      JOIN courses c ON c.id = e.course_id WHERE e.id = ?`).get(existing.id));
  } catch (err) {
    if (isDuplicate(err)) return res.status(409).json({ error: 'A slot for this course already exists at that date and start time' });
    throw err;
  }
});

router.delete('/:id', (req, res) => {
  const slot = db.prepare('SELECT id FROM exam_slots WHERE id = ?').get(req.params.id);
  if (!slot) return res.status(404).json({ error: 'Exam slot not found' });
  const selected = db.prepare('SELECT COUNT(*) AS n FROM selections WHERE slot_id = ?').get(slot.id).n;
  if (selected) return res.status(409).json({ error: 'This slot is already selected by a student and cannot be deleted.', selected_count: selected });
  db.prepare('DELETE FROM exam_slots WHERE id = ?').run(slot.id);
  res.json({ ok: true });
});

export default router;
