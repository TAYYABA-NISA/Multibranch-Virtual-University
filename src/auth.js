import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { sendMail } from './mailer.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && SECRET === 'dev-secret-change-me') {
  throw new Error('Set JWT_SECRET before running in production');
}
const TOKEN_HOURS = 24;

export const signToken = (userId) => jwt.sign({ id: userId }, SECRET, { expiresIn: '8h' });

// ----- middleware -----
// Reads "Authorization: Bearer <token>", then loads the user (and CURRENT role) from the database.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(jwt.verify(token, SECRET).id);
    if (!user) return res.status(401).json({ error: 'Unknown user' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// app.use('/api/admin', requireAuth, requireRole('admin'))
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' });

// ----- one-time, time-limited password links -----
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Creates a link token. Only its hash is saved, so a stolen database cannot be used to set passwords.
export function issuePasswordToken(userId) {
  db.prepare("UPDATE password_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(userId); // old links stop working
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TOKEN_HOURS * 3600e3).toISOString();
  db.prepare('INSERT INTO password_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(userId, hash(token), expires);
  return token;
}

// Returns the user id if the token is valid, not used and not expired. Otherwise null.
export function checkPasswordToken(token) {
  const row = db.prepare('SELECT * FROM password_tokens WHERE token_hash = ?').get(hash(String(token || '')));
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
  return row;
}

export async function sendPasswordEmail(user, kind) {
  const link = `${process.env.APP_URL || `http://localhost:${process.env.PORT || 4000}`}/set-password.html?token=${issuePasswordToken(user.id)}`;
  const welcome = kind === 'welcome';
  await sendMail({
    to: user.email,
    subject: welcome ? 'Your ExamSlot account is ready' : 'Reset your ExamSlot password',
    text: `${welcome ? 'An ExamSlot portal account has been created for you.' : 'We received a request to reset your password.'}\n\n` +
      `Set your password here (the link works once and expires in ${TOKEN_HOURS} hours):\n${link}\n\nIf you did not expect this email, you can ignore it.`,
  });
}
