// Run: npm test   (uses an in-memory database, nothing is written to disk)
process.env.DB_FILE = ':memory:';
const { default: app } = await import('../src/app.js');
const { seed } = await import('../src/seed.js');
const { db } = await import('../src/db.js');
const { outbox } = await import('../src/mailer.js');
seed();

const server = app.listen(0);
const BASE = `http://localhost:${server.address().port}`;
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failed++; };
const call = async (path, { token, method = 'GET', body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const login = async (email, password) => (await call('/api/auth/login', { method: 'POST', body: { email, password } }));

// ---- login and roles ----
const bad = await login('admin@examslot.test', 'wrong');
check('wrong password rejected', bad.status === 401);
check('unknown email gets the same message', (await login('nobody@x.com', 'x')).data.error === bad.data.error);
const admin = (await login('admin@examslot.test', 'admin123')).data.token;
const student = (await login('ayesha.khan@student.edu', 'student123')).data.token;
check('admin and student can log in', !!admin && !!student);
check('no token rejected', (await call('/api/admin/branches')).status === 401);
check('student blocked from admin routes', (await call('/api/admin/branches', { token: student })).status === 403);
check('passwords are hashed in the database', db.prepare("SELECT password_hash FROM users WHERE role='admin'").get().password_hash.startsWith('$2'));

// ---- branches: list, search, pagination ----
const all = await call('/api/admin/branches', { token: admin });
check('seed has 3 branches', all.data.total === 3);
const p1 = await call('/api/admin/branches?size=2&page=1', { token: admin });
const p2 = await call('/api/admin/branches?size=2&page=2', { token: admin });
check('server returns only one page (2 of 3, then 1)', p1.data.items.length === 2 && p2.data.items.length === 1 && p1.data.pages === 2);
const found = await call('/api/admin/branches?search=kara&size=2', { token: admin });
check('search is filtered and total reflects the filter', found.data.total === 1 && found.data.pages === 1 && found.data.items[0].code === 'KHI');
check('search wildcard characters are not special', (await call('/api/admin/branches?search=%25', { token: admin })).data.total === 0);

// ---- branches: create, validate, update ----
const make = { name: 'Multan Campus', code: 'mux', city: 'Multan', address: 'Bosan Road', phone: '061 111', status: 'active' };
const created = await call('/api/admin/branches', { token: admin, method: 'POST', body: make });
check('create branch (code upper-cased)', created.status === 201 && created.data.code === 'MUX');
check('duplicate code rejected', (await call('/api/admin/branches', { token: admin, method: 'POST', body: make })).status === 409);
check('invalid input rejected', (await call('/api/admin/branches', { token: admin, method: 'POST', body: { ...make, code: 'Q', name: '' } })).status === 400);
check('update branch', (await call(`/api/admin/branches/${created.data.id}`, { token: admin, method: 'PUT', body: { ...make, city: 'Multan City' } })).data.city === 'Multan City');

// ---- branches: safe delete ----
db.prepare('UPDATE students SET branch_id = 1 WHERE reg_no = ?').run('BC210401');
const blocked = await call('/api/admin/branches/1', { token: admin, method: 'DELETE' });
check('branch chosen by a student cannot be deleted', blocked.status === 409 && blocked.data.student_count === 1);
check('unused branch can be deleted', (await call(`/api/admin/branches/${created.data.id}`, { token: admin, method: 'DELETE' })).status === 200);
check('deleted branch is gone', (await call(`/api/admin/branches/${created.data.id}`, { token: admin })).status === 404);

// ---- password link: forgot, single use, expiry ----
const reply = await call('/api/auth/forgot', { method: 'POST', body: { email: 'bilal.khan@student.edu' } });
const unknown = await call('/api/auth/forgot', { method: 'POST', body: { email: 'ghost@x.com' } });
check('forgot gives the same reply for known and unknown emails', reply.status === 200 && reply.data.message === unknown.data.message);
check('exactly one email was sent', outbox.length === 1 && outbox[0].to === 'bilal.khan@student.edu');
const token = outbox[0].text.match(/token=([a-f0-9]+)/)[1];
check('token is not stored in plain text', !db.prepare('SELECT token_hash FROM password_tokens').all().some(r => r.token_hash === token));
check('short password rejected', (await call('/api/auth/set-password', { method: 'POST', body: { token, password: 'short' } })).status === 400);
check('set password with the link', (await call('/api/auth/set-password', { method: 'POST', body: { token, password: 'NewPassw0rd!' } })).status === 200);
check('can log in with the new password', (await login('bilal.khan@student.edu', 'NewPassw0rd!')).status === 200);
check('old password no longer works', (await login('bilal.khan@student.edu', 'student123')).status === 401);
check('link is single use', (await call('/api/auth/set-password', { method: 'POST', body: { token, password: 'AnotherPass1!' } })).status === 400);
await call('/api/auth/forgot', { method: 'POST', body: { email: 'bilal.khan@student.edu' } });
const t2 = outbox[1].text.match(/token=([a-f0-9]+)/)[1];
db.prepare("UPDATE password_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE used_at IS NULL").run();
check('expired link rejected', (await call('/api/auth/set-password', { method: 'POST', body: { token: t2, password: 'AnotherPass1!' } })).status === 400);
check('made-up token rejected', (await call('/api/auth/set-password', { method: 'POST', body: { token: 'abc', password: 'AnotherPass1!' } })).status === 400);
// a student who never set a password (account just created)
const uid = db.prepare("INSERT INTO users (email, role) VALUES ('new@student.edu', 'student')").run().lastInsertRowid;
check('account with no password cannot log in', (await login('new@student.edu', '')).status === 401 && !!uid);

// ---- course and exam slot CRUD ----
const courseBody = { code: 'TST-901', title: 'CRUD Test Course', credit_hours: 3, department: 'Testing', status: 'active' };
const courseCreated = await call('/api/admin/courses', { token: admin, method: 'POST', body: courseBody });
check('create course', courseCreated.status === 201 && courseCreated.data.code === 'TST-901');
check('duplicate course code rejected', (await call('/api/admin/courses', { token: admin, method: 'POST', body: courseBody })).status === 409);
const courseId = courseCreated.data.id;
check('update course', (await call(`/api/admin/courses/${courseId}`, { token: admin, method: 'PUT', body: { ...courseBody, title: 'Updated Test Course' } })).data.title === 'Updated Test Course');
check('course with student assignments cannot be deleted', (await call('/api/admin/courses/1', { token: admin, method: 'DELETE' })).status === 409);

const slotBody = { course_id: courseId, date: '2028-01-01', start_time: '09:00', end_time: '11:00' };
const slotCreated = await call('/api/admin/exam-slots', { token: admin, method: 'POST', body: slotBody });
check('create exam slot', slotCreated.status === 201 && slotCreated.data.date === slotBody.date);
const slotId = slotCreated.data.id;
check('duplicate overlapping slot rejected', (await call('/api/admin/exam-slots', { token: admin, method: 'POST', body: { ...slotBody, course_id: 1, start_time: '10:00', end_time: '12:00' } })).status === 409);
check('invalid time range rejected', (await call('/api/admin/exam-slots', { token: admin, method: 'POST', body: { ...slotBody, start_time: '12:00', end_time: '10:00' } })).status === 400);
check('get exam slot for editing', (await call(`/api/admin/exam-slots/${slotId}`, { token: admin })).data.id === slotId);
db.prepare('INSERT INTO selections (student_id, course_id, slot_id) VALUES (1, ?, ?)').run(courseId, slotId);
check('selected slot cannot be edited or deleted', (await call(`/api/admin/exam-slots/${slotId}`, { token: admin, method: 'PUT', body: { ...slotBody, start_time: '13:00', end_time: '15:00' } })).status === 409
  && (await call(`/api/admin/exam-slots/${slotId}`, { token: admin, method: 'DELETE' })).status === 409);
db.prepare('DELETE FROM selections WHERE student_id = 1 AND course_id = ?').run(courseId);
check('delete unused exam slot', (await call(`/api/admin/exam-slots/${slotId}`, { token: admin, method: 'DELETE' })).status === 200);
check('delete unused course', (await call(`/api/admin/courses/${courseId}`, { token: admin, method: 'DELETE' })).status === 200);

const seededSlots = db.prepare('SELECT date, start_time, end_time FROM exam_slots ORDER BY id').all();
check('seeded exam dates are fixed and no two seeded slots overlap', seededSlots.length === 24
  && seededSlots.every((slot) => slot.date.startsWith('2027-01-'))
  && seededSlots.every((a, i) => seededSlots.slice(i + 1).every((b) => a.date !== b.date
    || a.start_time >= b.end_time || b.start_time >= a.end_time)));
db.prepare("UPDATE exam_slots SET date = '2026-12-01'").run();
seed();
const migratedSlots = db.prepare('SELECT date, start_time, end_time FROM exam_slots ORDER BY id').all();
check('existing unselected demo slots migrate to fixed non-overlapping dates', migratedSlots.length === 24
  && migratedSlots.every((slot) => slot.date.startsWith('2027-01-'))
  && migratedSlots.every((a, i) => migratedSlots.slice(i + 1).every((b) => a.date !== b.date
    || a.start_time >= b.end_time || b.start_time >= a.end_time)));

// ---- student CRUD and setup email ----
const studentBody = { full_name: 'CRUD Student', email: 'crud.student@student.edu', reg_no: 'CRUD-0001', program: 'BS Testing', semester: 2 };
const studentCreated = await call('/api/admin/students', { token: admin, method: 'POST', body: studentBody });
check('create student and send setup email', studentCreated.status === 201 && studentCreated.data.email === studentBody.email
  && outbox.at(-1).to === studentBody.email);
const createdStudentId = studentCreated.data.id;
check('new student cannot log in before setting a password', (await login(studentBody.email, '')).status === 401);
check('resend student setup email', (await call(`/api/admin/students/${createdStudentId}/setup-email`, { token: admin, method: 'POST', body: {} })).status === 200);
check('update student profile', (await call(`/api/admin/students/${createdStudentId}`, { token: admin, method: 'PUT', body: { ...studentBody, full_name: 'Updated CRUD Student', phone: '555-0100' } })).status === 200
  && db.prepare('SELECT full_name, phone FROM students WHERE id = ?').get(createdStudentId).full_name === 'Updated CRUD Student');
check('delete student record and login', (await call(`/api/admin/students/${createdStudentId}`, { token: admin, method: 'DELETE' })).status === 200
  && !db.prepare("SELECT 1 FROM users WHERE email = 'crud.student@student.edu'").get());

server.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
