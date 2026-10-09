// A fake backend inside the browser. It enforces the same rules the real one must:
// branch once, 4 to 6 courses, one slot per course, no clashes, save once, one-time unlock.

const db = {
  branches: [
    { id: 1, name: 'Lahore Campus', code: 'LHR', city: 'Lahore', address: '12 Canal Road' },
    { id: 2, name: 'Karachi Campus', code: 'KHI', city: 'Karachi', address: '45 University Avenue' },
    { id: 3, name: 'Islamabad Campus', code: 'ISB', city: 'Islamabad', address: 'Sector H-9' },
  ],
  courses: [
    [1, 'CS-210', 'Data Structures', 4], [2, 'SE-301', 'Software Design', 3], [3, 'CS-315', 'Database Systems', 3],
    [4, 'MT-205', 'Discrete Mathematics', 3], [5, 'DS-201', 'Data Visualization', 3], [6, 'EN-101', 'Technical Writing', 2],
    [7, 'CS-330', 'Operating Systems', 4], [8, 'MG-210', 'Project Management', 3],
  ].map(([id, code, title, credits]) => ({ id, code, title, credits })),
  slots: [], requests: [],
};
// Fixed dates are unique per course so any choice of one of its slots is conflict-free.
db.courses.forEach(c => {
  const index = c.id - 1;
  db.slots.push({ id: c.id * 10 + 1, course_id: c.id, date: `2027-01-${String(index + 4).padStart(2, '0')}`, start: '09:00', end: '11:00' });
  db.slots.push({ id: c.id * 10 + 2, course_id: c.id, date: `2027-01-${String(index + 20).padStart(2, '0')}`, start: '14:00', end: '16:00' });
});

const person = (id, name, reg, program, semester, courses, gender) => ({
  id, name, email: name.toLowerCase().replace(/ /g, '.') + '@student.edu', password: 'student123',
  phone: '0300 12345' + id + '0', dob: '2003-03-1' + id, gender,
  guardian: { name: 'Imran ' + name.split(' ')[1], occupation: 'Businessman', phone: '0301 76543' + id + '0' },
  academic: { reg, program, semester, batch: '2021', cgpa: (3 + id / 10).toFixed(2) },
  courses, branch_id: null, sheet: null, unlock: { branch: false, sheet: false },
});
db.students = [
  person(1, 'Ayesha Khan', 'BC210401', 'BS Computer Science', 5, [1, 2, 3, 4, 5], 'Female'),
  person(2, 'Bilal Khan', 'BC210522', 'BS Software Engineering', 3, [2, 1, 4], 'Male'),
  person(3, 'Hina Khanzada', 'BC200318', 'BBA', 6, [3, 5, 6, 8], 'Female'),
  person(4, 'Usman Ali', 'BC220077', 'BS Data Science', 1, [1, 2, 3, 4, 5, 6], 'Male'),
  person(5, 'Sara Malik', 'BC210910', 'BS Computer Science', 5, [7, 1, 2, 3], 'Female'),
];

const slotOf = (id) => db.slots.find(s => s.id === id);
const courseOf = (id) => db.courses.find(c => c.id === id);
const overlap = (a, b) => a.date === b.date && a.start < b.end && b.start < a.end;
const sheetState = (s) => (s.sheet ? 'Saved' : 'Not saved');

// Returns the names of the first two chosen courses that clash, or null.
function findClash(choices) {
  for (let i = 0; i < choices.length; i++) for (let j = i + 1; j < choices.length; j++) {
    if (overlap(slotOf(choices[i].slot_id), slotOf(choices[j].slot_id)))
      return `${courseOf(choices[i].course_id).code} and ${courseOf(choices[j].course_id).code} are at the same date and time.`;
  }
  return null;
}

async function mockServer(path, body, token) {
  await new Promise(r => setTimeout(r, 200));
  const url = new URL(path, 'http://x');
  const p = url.pathname, q = url.searchParams;
  const out = (status, data) => ({ status, data });
  const err = (status, error) => out(status, { error });

  if (p === '/api/auth/login') {
    const email = String(body.email).trim().toLowerCase();
    if (email === 'admin@examslot.test' && body.password === 'admin123') return out(200, { token: 'mock-admin', user: { role: 'admin', name: 'Admin' } });
    const s = db.students.find(s => s.email === email);
    if (s && body.password === s.password) return out(200, { token: 'mock-s' + s.id, user: { role: 'student', id: s.id, name: s.name } });
    return err(401, 'Invalid email or password');
  }
  if (p === '/api/auth/forgot') return out(200, { message: 'If that email has an account, a reset link has been sent.' });
  const isAdmin = token === 'mock-admin';
  const me = db.students.find(s => 'mock-s' + s.id === token);
  if (!isAdmin && !me) return err(401, 'Login required');

  // ---------- student routes ----------
  if (p.startsWith('/api/student')) {
    if (!me) return err(403, 'Students only');
    if (p === '/api/student/me') {
      const rows = (me.sheet || []).map(c => ({ course: courseOf(c.course_id), slot: slotOf(c.slot_id) }))
        .sort((a, b) => (a.slot.date + a.slot.start).localeCompare(b.slot.date + b.slot.start));
      return out(200, {
        profile: me, branch: db.branches.find(b => b.id === me.branch_id) || null, branches: db.branches,
        courses: me.courses.map(id => ({ ...courseOf(id), slots: db.slots.filter(s => s.course_id === id) })),
        sheet: me.sheet ? rows : null, sheetChoices: me.sheet || [],
        requests: db.requests.filter(r => r.student_id === me.id),
        assignmentComplete: me.courses.length >= 4,
        canChooseBranch: !me.branch_id || me.unlock.branch, canEditSheet: !me.sheet || me.unlock.sheet,
      });
    }
    if (p === '/api/student/branch') {
      if (me.branch_id && !me.unlock.branch) return err(409, 'Branch already selected. Ask the admin to approve a change.');
      if (!db.branches.some(b => b.id === body.branch_id)) return err(400, 'Choose a valid branch');
      me.branch_id = body.branch_id; me.unlock.branch = false; // the unlock is used up
      return out(200, { ok: true });
    }
    if (p === '/api/student/sheet') {
      if (me.courses.length < 4) return err(400, 'Your course assignment is incomplete');
      if (!me.branch_id) return err(400, 'Choose your exam branch first');
      if (me.sheet && !me.unlock.sheet) return err(409, 'Date sheet already saved. Ask the admin to approve a change.');
      const ch = body.choices || [];
      if (me.courses.some(id => !ch.find(c => c.course_id === id))) return err(400, 'Pick a slot for every course');
      if (ch.some(c => !me.courses.includes(c.course_id) || slotOf(c.slot_id)?.course_id !== c.course_id)) return err(400, 'Invalid slot choice');
      const clash = findClash(ch);
      if (clash) return err(400, clash);
      me.sheet = ch.map(c => ({ course_id: c.course_id, slot_id: c.slot_id })); me.unlock.sheet = false;
      return out(200, { ok: true });
    }
    if (p === '/api/student/requests') {
      if (!['branch', 'sheet'].includes(body.type) || !String(body.reason || '').trim()) return err(400, 'Choose a type and write a reason');
      if (db.requests.some(r => r.student_id === me.id && r.type === body.type && r.status === 'pending')) return err(409, 'You already have a pending request of this type');
      db.requests.push({ id: db.requests.length + 1, student_id: me.id, type: body.type, reason: body.reason.trim(), status: 'pending', remark: '', raised: '2026-10-09' });
      return out(201, { ok: true });
    }
  }

  // ---------- admin routes ----------
  if (!isAdmin) return err(403, 'Admins only');
  if (p === '/api/admin/students') {
    const term = (q.get('search') || '').toLowerCase(), size = Number(q.get('size')) || 5;
    const all = db.students.filter(s => [s.name, s.email, s.academic.reg].join(' ').toLowerCase().includes(term));
    const pages = Math.max(1, Math.ceil(all.length / size)), page = Math.min(Number(q.get('page')) || 1, pages);
    const rows = all.slice((page - 1) * size, page * size).map(s => ({
      id: s.id, name: s.name, email: s.email, reg: s.academic.reg, program: s.academic.program, semester: s.academic.semester,
      course_count: s.courses.length, branch: db.branches.find(b => b.id === s.branch_id)?.name || 'Not chosen', sheet: sheetState(s),
    }));
    return out(200, { items: rows, total: all.length, page, pages, size });
  }
  let m = p.match(/^\/api\/admin\/students\/(\d+)$/);
  if (m) {
    const s = db.students.find(s => s.id === Number(m[1]));
    return s ? out(200, { student: { id: s.id, name: s.name, reg: s.academic.reg, program: s.academic.program, semester: s.academic.semester },
      assigned: s.courses.map(courseOf), available: db.courses.filter(c => !s.courses.includes(c.id)), locked: !!s.sheet && !s.unlock.sheet }) : err(404, 'Student not found');
  }
  m = p.match(/^\/api\/admin\/students\/(\d+)\/(assign|unassign)$/);
  if (m) {
    const s = db.students.find(s => s.id === Number(m[1]));
    if (!s) return err(404, 'Student not found');
    if (s.sheet && !s.unlock.sheet) return err(409, 'This student has saved a date sheet. Approve a change request first.');
    if (m[2] === 'assign') {
      if (s.courses.includes(body.course_id)) return err(409, 'Course already assigned to this student');
      if (s.courses.length >= 6) return err(400, 'A student can have at most 6 courses');
      s.courses.push(body.course_id);
    } else s.courses = s.courses.filter(id => id !== body.course_id);
    if (s.unlock.sheet) s.unlock.sheet = false;
    return out(200, { ok: true });
  }
  if (p === '/api/admin/requests') {
    const status = q.get('status');
    const items = db.requests.filter(r => (!status || r.status === status) && (!q.get('type') || r.type === q.get('type')))
      .map(r => ({ ...r, student_name: db.students.find(s => s.id === r.student_id).name }));
    return out(200, { items, total: items.length, page: 1, pages: 1, size: 10 });
  }
  m = p.match(/^\/api\/admin\/requests\/(\d+)\/decide$/);
  if (m) {
    const r = db.requests.find(r => r.id === Number(m[1]));
    if (!r || r.status !== 'pending') return err(409, 'Request not found or already decided');
    r.status = body.status === 'approved' ? 'approved' : 'rejected'; r.remark = body.remark || '';
    if (r.status === 'approved') db.students.find(s => s.id === r.student_id).unlock[r.type] = true; // one-time unlock
    return out(200, { ok: true });
  }
  return err(404, 'Not found');
}
