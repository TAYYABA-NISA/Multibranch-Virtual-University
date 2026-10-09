import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import branchRoutes from './routes/branches.js';
import studentRoutes from './routes/student.js';
import adminStudentRoutes from './routes/adminStudents.js';
import adminRequestRoutes from './routes/adminRequests.js';
import { requireAuth, requireRole } from './auth.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);

// Everything under /api/admin needs a logged-in ADMIN. Students get 403 here.
app.use('/api/admin', requireAuth, requireRole('admin'));
app.use('/api/admin/branches', branchRoutes);
app.use('/api/admin/students', adminStudentRoutes);
app.use('/api/admin/requests', adminRequestRoutes);
// Still to add: courses CRUD, student create/edit/delete with the welcome email, exam slot CRUD

// Everything under /api/student is for a logged-in STUDENT only.
app.use('/api/student', requireAuth, requireRole('student'), studentRoutes);

// The website (public/) is served by this same server, so the browser needs no cross-site permission.
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

export default app;
