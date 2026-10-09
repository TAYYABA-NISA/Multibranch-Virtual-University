import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db.js';
import { signToken, requireAuth, checkPasswordToken, sendPasswordEmail } from '../auth.js';
import { validate } from '../validate.js';

const router = Router();

router.post('/login', validate(z.object({ email: z.string().trim().toLowerCase(), password: z.string() })), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(req.body.email);
  // Same answer for "no such user", "no password yet" and "wrong password", so nobody can probe which emails exist.
  if (!user || !user.password_hash || !bcrypt.compareSync(req.body.password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password. If you never set a password, use "Forgot password".' });
  }
  const student = user.role === 'student' ? db.prepare('SELECT full_name FROM students WHERE user_id = ?').get(user.id) : null;
  res.json({ token: signToken(user.id), user: { id: user.id, email: user.email, role: user.role, name: student?.full_name || 'Admin' } });
});

// Always the same reply, whether or not the email exists.
router.post('/forgot', validate(z.object({ email: z.string().trim().toLowerCase() })), async (req, res, next) => {
  try {
    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(req.body.email);
    if (user) await sendPasswordEmail(user, 'reset');
    res.json({ message: 'If that email has an account, a reset link has been sent.' });
  } catch (err) { next(err); }
});

router.post('/set-password', validate(z.object({ token: z.string(), password: z.string().min(8, 'must be at least 8 characters') })), (req, res) => {
  const row = checkPasswordToken(req.body.token);
  if (!row) return res.status(400).json({ error: 'This link is invalid, already used, or has expired. Request a new one.' });
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(req.body.password, 10), row.user_id);
    db.prepare("UPDATE password_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id); // single use
  })();
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json(req.user));

export default router;
