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

server.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
