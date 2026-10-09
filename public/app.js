// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dayShort = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
const dayLong = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
const to12 = (t) => { const [h, m] = t.split(':').map(Number); return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const range = (s) => (s.end ? `${to12(s.start)} to ${to12(s.end)}` : to12(s.start));
const show = (html) => { $('#page').innerHTML = html; };
let toastTimer;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3200);
}

let user = JSON.parse(localStorage.getItem('exam_user') || 'null');
let me = null;                                    // the student's data from the server
let choices = {};                                 // course id -> slot id, while designing
let paging = { search: '', page: 1, size: 5 };      // admin students paging state
let requestStatus = '';                           // admin requests filter
let timer;                                        // search debounce

// Wrap a screen so errors show on the page and an expired login goes back to login.
const safe = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) {
    if (e.status === 401) return logout();
    show(`<p class="error pad">${esc(e.message)}</p>`);
  }
};

// ---------- login and logout ----------
function demo(email, password) { $('#email').value = email; $('#password').value = password; }

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#login-error').textContent = '';
  try {
    const data = await api('/api/auth/login', { email: $('#email').value, password: $('#password').value });
    localStorage.setItem('exam_token', data.token);
    localStorage.setItem('exam_user', JSON.stringify(data.user));
    user = data.user;
    start();
  } catch (err) { $('#login-error').textContent = err.message; }
});

async function forgot() {
  const email = prompt('Enter your account email');
  if (!email) return;
  try { $('#login-error').textContent = (await api('/api/auth/forgot', { email })).message; }
  catch (e) { $('#login-error').textContent = e.message; }
}

function logout() {
  localStorage.removeItem('exam_token');
  localStorage.removeItem('exam_user');
  user = null; me = null;
  $('#page').hidden = true;
  $('#login-page').hidden = false;
}

function start() {
  $('#login-page').hidden = true;
  $('#page').hidden = false;
  if (user.role === 'admin') adminStudents(); else studentHome();
}

// ---------- page frames ----------
function adminFrame(active, inner) {
  const link = (id, label, fn) => `<a class="${active === id ? 'on' : ''}" ${active === id ? 'aria-current="page"' : ''} href="#" onclick="event.preventDefault(); ${fn}()">${label}</a>`;
  return `<div class="admin"><aside class="side"><div class="side-head"><div class="brand"><span class="brand-mark" aria-hidden="true">E</span> ExamSlot <small>Admin</small></div>
      <button class="b o s nav-toggle" type="button" aria-expanded="false" aria-controls="admin-nav" onclick="toggleAdminNav(this)">Menu</button></div>
    <nav id="admin-nav" class="nav" aria-label="Admin navigation">${link('branches', 'Branches', 'adminBranches')}${link('courses', 'Courses', 'adminCourses')}${link('students', 'Students', 'adminStudents')}${link('slots', 'Exam slots', 'adminSlots')}${link('requests', 'Change requests', 'adminRequests')}</nav>
    <button class="b o s" type="button" onclick="logout()">Sign out</button></aside><main class="main">${inner}</main></div>`;
}
function toggleAdminNav(button) {
  const expanded = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(expanded));
  $('#admin-nav').classList.toggle('open', expanded);
}
function studentFrame(step, inner) {
  const s = (n, label) => `<div><span class="dot ${step >= n ? 'on' : ''}">${step > n ? '&#10003;' : n}</span>${step === n ? `<b>${label}</b>` : label}</div>`;
  return `<header class="top"><div class="brand"><span class="brand-mark" aria-hidden="true">E</span> ExamSlot</div>
      <div>${esc(user.name)} <button class="link-button" type="button" onclick="logout()">Sign out</button></div></header>
    <main class="wrap"><div class="steps" aria-label="Date sheet progress">${s(1, 'Choose branch')}${s(2, 'Pick dates')}${s(3, 'Print date sheet')}</div>${inner}</main>`;
}

// ================= ADMIN =================
function pageControls(result, stateName, loaderName) {
  const state = stateName === 'branchState' ? branchState : courseState;
  const first = result.total ? (result.page - 1) * result.size + 1 : 0;
  const last = Math.min(result.page * result.size, result.total);
  return `<div class="row k"><span>Showing ${first}–${last} of ${result.total}</span>
    <span><button class="b o s" ${result.page <= 1 ? 'disabled' : ''} onclick="${stateName}.page--; ${loaderName}()">Previous</button>
      Page ${result.page} of ${result.pages}
      <button class="b o s" ${result.page >= result.pages ? 'disabled' : ''} onclick="${stateName}.page++; ${loaderName}()">Next</button></span></div>`;
}

let branchState = { search: '', page: 1, size: 10 };
const adminBranches = safe(async (error = '') => {
  const result = await api('/api/admin/branches?' + new URLSearchParams(branchState));
  branchState.page = result.page;
  const rows = result.items.map((b) => `<tr>
    <td data-label="Branch"><b>${esc(b.name)}</b><div class="k">${esc(b.code)}</div></td>
    <td data-label="City">${esc(b.city)}</td><td data-label="Contact">${esc(b.phone || '—')}</td>
    <td data-label="Students">${b.student_count}</td><td data-label="Status"><span class="t ${b.status === 'active' ? 'g' : 'r'}">${b.status}</span></td>
    <td data-label="Actions"><div class="table-actions"><button class="b o s" onclick="editBranch(${b.id})">Edit</button>
      <button class="b o s danger-action" onclick="deleteBranch(${b.id})">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="6">No branches found.</td></tr>';
  show(adminFrame('branches', `<div class="row"><div><h1>Branches</h1><p class="k">Manage exam locations. Branches selected by students cannot be deleted.</p></div><button class="b" onclick="editBranch()">Add branch</button></div>
    ${error ? `<div class="banner bad" role="alert">${esc(error)}</div>` : ''}
    <input type="search" aria-label="Search branches" placeholder="Search name, code, or city" value="${esc(branchState.search)}" oninput="clearTimeout(timer); timer=setTimeout(()=>{branchState.search=this.value;branchState.page=1;adminBranches()},300)">
    <div class="tw"><table><thead><tr><th>Branch</th><th>City</th><th>Contact</th><th>Students</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${pageControls(result, 'branchState', 'adminBranches')}`));
});
const branchForm = safe(async (id, error = '') => {
  const b = id ? await api(`/api/admin/branches/${id}`) : { name: '', code: '', city: '', address: '', phone: '', status: 'active' };
  show(adminFrame('branches', `<div><a href="#" onclick="event.preventDefault(); adminBranches()">← Back to branches</a><h1>${id ? 'Edit branch' : 'Add branch'}</h1></div>
    ${error ? `<div class="banner bad" role="alert">${esc(error)}</div>` : ''}
    <form class="c stack" onsubmit="saveBranchAdmin(event, ${id || 'null'})">
      <div class="form-grid">
        <label>Branch name *<input name="name" required minlength="2" maxlength="80" value="${esc(b.name)}"></label>
        <label>Branch code *<input name="code" required minlength="2" maxlength="10" value="${esc(b.code)}"></label>
        <label>City *<input name="city" required value="${esc(b.city)}"></label>
        <label>Contact number<input name="phone" value="${esc(b.phone || '')}"></label>
        <label class="span-all">Address *<input name="address" required value="${esc(b.address)}"></label>
        <label>Status<select name="status"><option value="active" ${b.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${b.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label>
      </div><div class="row"><button type="button" class="b o" onclick="adminBranches()">Cancel</button><button class="b">${id ? 'Save changes' : 'Create branch'}</button></div>
    </form>`));
});
function editBranch(id) { branchForm(id); }
async function saveBranchAdmin(event, id) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await api(id ? `/api/admin/branches/${id}` : '/api/admin/branches', body, id ? 'PUT' : 'POST');
    toast(id ? 'Branch updated.' : 'Branch created.');
    adminBranches();
  } catch (err) { branchForm(id, err.message); }
}
const deleteBranch = safe(async (id) => {
  if (!window.confirm('Delete this branch? If students have selected it, deletion will be blocked; mark it inactive instead.')) return;
  try {
    await api(`/api/admin/branches/${id}`, null, 'DELETE');
    toast('Branch deleted.');
    adminBranches();
  } catch (err) { adminBranches(err.message); }
});

let courseState = { search: '', page: 1, size: 10 };
const adminCourses = safe(async (error = '') => {
  const result = await api('/api/admin/courses?' + new URLSearchParams(courseState));
  courseState.page = result.page;
  const rows = result.items.map((c) => `<tr>
    <td data-label="Code"><b>${esc(c.code)}</b></td><td data-label="Course">${esc(c.title)}</td>
    <td data-label="Credits">${c.credit_hours}</td><td data-label="Department">${esc(c.department || '—')}</td>
    <td data-label="Usage">${c.student_count} student(s), ${c.slot_count} slot(s)</td>
    <td data-label="Status"><span class="t ${c.status === 'active' ? 'g' : 'r'}">${c.status}</span></td>
    <td data-label="Actions"><div class="table-actions"><button class="b o s" onclick="editCourse(${c.id})">Edit</button>
      <button class="b o s danger-action" onclick="deleteCourse(${c.id})">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="7">No courses found.</td></tr>';
  show(adminFrame('courses', `<div class="row"><div><h1>Courses</h1><p class="k">Manage course details and availability.</p></div><button class="b" onclick="editCourse()">Add course</button></div>
    ${error ? `<div class="banner bad" role="alert">${esc(error)}</div>` : ''}
    <input type="search" aria-label="Search courses" placeholder="Search code, title, or department" value="${esc(courseState.search)}" oninput="clearTimeout(timer); timer=setTimeout(()=>{courseState.search=this.value;courseState.page=1;adminCourses()},300)">
    <div class="tw"><table><thead><tr><th>Code</th><th>Course</th><th>Credits</th><th>Department</th><th>Usage</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${pageControls(result, 'courseState', 'adminCourses')}`));
});
const courseForm = safe(async (id, error = '') => {
  const c = id ? await api(`/api/admin/courses/${id}`) : { code: '', title: '', credit_hours: 3, department: '', status: 'active' };
  show(adminFrame('courses', `<div><a href="#" onclick="event.preventDefault(); adminCourses()">← Back to courses</a><h1>${id ? 'Edit course' : 'Add course'}</h1></div>
    ${error ? `<div class="banner bad" role="alert">${esc(error)}</div>` : ''}
    <form class="c stack" onsubmit="saveCourse(event, ${id || 'null'})"><div class="form-grid">
      <label>Course code *<input name="code" required minlength="2" maxlength="20" value="${esc(c.code)}"></label>
      <label>Title *<input name="title" required maxlength="120" value="${esc(c.title)}"></label>
      <label>Credit hours *<input name="credit_hours" type="number" min="1" max="6" step="1" required value="${c.credit_hours}"></label>
      <label>Department<input name="department" maxlength="80" value="${esc(c.department || '')}"></label>
      <label>Status<select name="status"><option value="active" ${c.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${c.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label>
    </div><div class="row"><button type="button" class="b o" onclick="adminCourses()">Cancel</button><button class="b">${id ? 'Save changes' : 'Create course'}</button></div></form>`));
});
function editCourse(id) { courseForm(id); }
async function saveCourse(event, id) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  body.credit_hours = Number(body.credit_hours);
  try {
    await api(id ? `/api/admin/courses/${id}` : '/api/admin/courses', body, id ? 'PUT' : 'POST');
    toast(id ? 'Course updated.' : 'Course created.');
    adminCourses();
  } catch (err) { courseForm(id, err.message); }
}
const deleteCourse = safe(async (id) => {
  if (!window.confirm('Delete this course? Courses with student assignments or exam slots must be marked inactive instead.')) return;
  try {
    await api(`/api/admin/courses/${id}`, null, 'DELETE');
    toast('Course deleted.');
    adminCourses();
  } catch (err) { adminCourses(err.message); }
});

let slotState = { search: '', page: 1, size: 10 };
const adminSlots = safe(async (error = '') => {
  const result = await api('/api/admin/exam-slots?' + new URLSearchParams(slotState));
  slotState.page = result.page;
  const rows = result.items.map((slot) => `<tr>
    <td data-label="Course"><b>${esc(slot.code)}</b><div class="k">${esc(slot.title)}</div></td>
    <td data-label="Date">${dayLong(slot.date)}</td><td data-label="Time">${range({ start: slot.start_time, end: slot.end_time })}</td>
    <td data-label="Selected"><span class="t ${slot.selected_count ? 'a' : 'g'}">${slot.selected_count} student(s)</span></td>
    <td data-label="Actions"><div class="table-actions"><button class="b o s" ${slot.selected_count ? 'disabled title="Slot has already been selected"' : ''} onclick="editSlot(${slot.id})">Edit</button>
      <button class="b o s danger-action" ${slot.selected_count ? 'disabled title="Slot has already been selected"' : ''} onclick="deleteSlot(${slot.id})">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="5">No exam slots found.</td></tr>';
  show(adminFrame('slots', `<div class="row"><div><h1>Exam slots</h1><p class="k">Slots cannot overlap another course’s slot. Slots already selected by students are protected.</p></div><button class="b" onclick="editSlot()">Add exam slot</button></div>
    ${error ? `<div class="banner bad" role="alert">${esc(error)}</div>` : ''}
    <input type="search" aria-label="Search exam slots" placeholder="Search by course code or title" value="${esc(slotState.search)}" oninput="clearTimeout(timer); timer=setTimeout(()=>{slotState.search=this.value;slotState.page=1;adminSlots()},300)">
    <div class="tw"><table><thead><tr><th>Course</th><th>Date</th><th>Time</th><th>Selected</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="row k"><span>Showing ${result.total ? (result.page - 1) * result.size + 1 : 0}–${Math.min(result.page * result.size, result.total)} of ${result.total}</span>
      <span><button class="b o s" ${result.page <= 1 ? 'disabled' : ''} onclick="slotState.page--; adminSlots()">Previous</button> Page ${result.page} of ${result.pages}
      <button class="b o s" ${result.page >= result.pages ? 'disabled' : ''} onclick="slotState.page++; adminSlots()">Next</button></span></div>`));
});
const slotForm = safe(async (id, error = '') => {
  const [slot, courseResult] = await Promise.all([
    id ? api(`/api/admin/exam-slots/${id}`) : Promise.resolve({ course_id: '', date: '', start_time: '09:00', end_time: '11:00' }),
    api('/api/admin/courses?size=100&status=active'),
  ]);
  const courses = courseResult.items || [];
  show(adminFrame('slots', `<div><a href="#" onclick="event.preventDefault(); adminSlots()">← Back to exam slots</a><h1>${id ? 'Edit exam slot' : 'Add exam slot'}</h1></div>
    <p class="k">Dates and times must not overlap any other course’s exam slot.</p>${error ? `<div class="banner bad" role="alert">${esc(error)}</div>` : ''}
    <form class="c stack" onsubmit="saveSlot(event, ${id || 'null'})"><div class="form-grid">
      <label>Course *<select name="course_id" required><option value="">Choose course</option>${courses.map(c => `<option value="${c.id}" ${Number(slot.course_id) === c.id ? 'selected' : ''}>${esc(c.code)} — ${esc(c.title)}</option>`).join('')}</select></label>
      <label>Exam date *<input name="date" type="date" required value="${esc(slot.date)}"></label>
      <label>Start time *<input name="start_time" type="time" required value="${esc(slot.start_time)}"></label>
      <label>End time *<input name="end_time" type="time" required value="${esc(slot.end_time)}"></label>
    </div><div class="row"><button type="button" class="b o" onclick="adminSlots()">Cancel</button><button class="b">${id ? 'Save changes' : 'Create slot'}</button></div></form>`));
});
function editSlot(id) { slotForm(id); }
async function saveSlot(event, id) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  body.course_id = Number(body.course_id);
  try {
    await api(id ? `/api/admin/exam-slots/${id}` : '/api/admin/exam-slots', body, id ? 'PUT' : 'POST');
    toast(id ? 'Exam slot updated.' : 'Exam slot created.');
    adminSlots();
  } catch (err) { slotForm(id, err.message); }
}
const deleteSlot = safe(async (id) => {
  if (!window.confirm('Delete this exam slot?')) return;
  try {
    await api(`/api/admin/exam-slots/${id}`, null, 'DELETE');
    toast('Exam slot deleted.');
    adminSlots();
  } catch (err) { adminSlots(err.message); }
});

const adminStudents = safe(async () => {
  show(adminFrame('students', `
    <div class="row"><div><h1>Students</h1><p class="k">Create and manage student accounts, records, and course assignments.</p></div>
      <button class="b" onclick="editStudent()">Add student</button></div>
    <input id="search" type="search" aria-label="Search students by name, email or registration number" placeholder="Search name, email or registration number" value="${esc(paging.search)}"
      oninput="clearTimeout(timer); timer = setTimeout(() => { paging.search = this.value; paging.page = 1; loadStudents(); }, 300)">
    <div id="tbl"></div>`));
  await loadStudents();
});

const loadStudents = safe(async () => {
  const host = $('#tbl');
  host.setAttribute('aria-busy', 'true');
  host.innerHTML = `<div class="skeleton-list" role="status" aria-label="Loading students">${Array.from({ length: 3 }, () => '<div class="skeleton-card"><span></span><span></span><span></span></div>').join('')}</div>`;
  const q = new URLSearchParams(paging);
  const d = await api('/api/admin/students?' + q);
  host.removeAttribute('aria-busy');
  paging.page = d.page;
  const from = d.total ? (d.page - 1) * d.size + 1 : 0, to = Math.min(d.page * d.size, d.total);
  host.innerHTML = `<div class="tw"><table><thead><tr><th scope="col">Student</th><th scope="col">Program</th><th scope="col">Courses</th><th scope="col">Branch</th><th scope="col">Date sheet</th><th scope="col">Actions</th></tr></thead><tbody>` +
    (d.items.map(s => `<tr>
      <td data-label="Student"><b>${esc(s.name)}</b><div class="k">${esc(s.reg)} | ${esc(s.email)}</div></td><td data-label="Program">${esc(s.program)}, Sem ${s.semester}</td>
      <td data-label="Courses"><span class="t ${s.course_count < 4 ? 'a' : 'g'}">${s.course_count < 4 ? 'Incomplete: ' + s.course_count : s.course_count + ' of 6'}</span></td>
      <td data-label="Branch">${esc(s.branch)}</td><td data-label="Date sheet"><span class="t ${s.sheet === 'Saved' ? 'g' : ''}">${esc(s.sheet)}</span></td>
      <td data-label="Actions"><div class="table-actions">
        <button class="b o s" onclick="editStudent(${s.id})">Edit</button>
        <button class="b o s" onclick="adminAssign(${s.id})">Courses</button>
        <button class="b o s" onclick="sendSetupEmail(${s.id})">Setup email</button>
        <button class="b o s danger-action" onclick="deleteStudent(${s.id})">Delete</button>
      </div></td></tr>`).join('') ||
      '<tr><td colspan="6" class="k">No students match your search.</td></tr>') + `</tbody></table></div>
    <div class="row k"><span>Showing ${from} to ${to} of ${d.total}</span>
      <span><select onchange="paging.size = Number(this.value); paging.page = 1; loadStudents()">${[5, 10].map(n => `<option ${d.size === n ? 'selected' : ''} value="${n}">${n} per page</option>`).join('')}</select>
        <button class="b o s" ${d.page <= 1 ? 'disabled' : ''} onclick="paging.page--; loadStudents()">Previous</button>
        Page ${d.page} of ${d.pages}
        <button class="b o s" ${d.page >= d.pages ? 'disabled' : ''} onclick="paging.page++; loadStudents()">Next</button></span></div>`;
});

const studentGroups = [
  ['Personal information', [
    ['full_name', 'Full name', 'text', true], ['email', 'Email address', 'email', true], ['phone', 'Phone', 'tel'],
    ['cnic', 'CNIC', 'text'], ['dob', 'Date of birth', 'date'], ['gender', 'Gender', 'select'],
    ['address', 'Address', 'text'],
  ]],
  ['Parent or guardian', [
    ['guardian_name', 'Guardian name', 'text'], ['guardian_cnic', 'Guardian CNIC', 'text'],
    ['guardian_occupation', 'Occupation', 'text'], ['guardian_phone', 'Guardian phone', 'tel'],
    ['emergency_contact', 'Emergency contact', 'tel'],
  ]],
  ['Academic information', [
    ['reg_no', 'Registration number', 'text', true], ['program', 'Program', 'text', true],
    ['semester', 'Semester', 'number', true], ['batch', 'Batch', 'text'],
    ['prev_qualification', 'Previous qualification', 'text'], ['prev_institute', 'Previous institute', 'text'],
    ['cgpa', 'CGPA (0–4)', 'number'],
  ]],
];
function editStudent(id) { studentForm(id); }
const studentForm = safe(async (id, error = '') => {
  const s = id ? (await api(`/api/admin/students/${id}`)).student : {};
  const field = ([name, label, type, required]) => {
    const value = s[name] ?? '';
    if (type === 'select') return `<label>${label}${required ? ' *' : ''}<select name="${name}"><option value="">Choose…</option>${['Female', 'Male', 'Other'].map((option) => `<option ${value === option ? 'selected' : ''}>${option}</option>`).join('')}</select></label>`;
    return `<label>${label}${required ? ' *' : ''}<input name="${name}" type="${type}" ${type === 'number' ? `min="${name === 'semester' ? 1 : 0}" max="${name === 'semester' ? 20 : 4}" step="${name === 'semester' ? 1 : 0.01}"` : ''} value="${esc(value)}" ${required ? 'required' : ''}></label>`;
  };
  show(adminFrame('students', `<div><a href="#" onclick="event.preventDefault(); adminStudents()">← Back to students</a><h1>${id ? 'Edit student' : 'Create student'}</h1>
    <p class="k">${id ? 'Update the student profile.' : 'A password setup link will be emailed to the student after creation.'}</p></div>
    ${error ? `<div class="banner bad" role="alert">${esc(error)}</div>` : ''}
    <form class="stack" onsubmit="saveStudent(event, ${id || 'null'})">
      ${studentGroups.map(([title, fields]) => `<fieldset class="c form-section"><legend>${title}</legend><div class="form-grid">${fields.map(field).join('')}</div></fieldset>`).join('')}
      <div class="row"><button type="button" class="b o" onclick="adminStudents()">Cancel</button><button type="submit" class="b">${id ? 'Save changes' : 'Create student'}</button></div>
    </form>`));
});
async function saveStudent(event, id) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  body.semester = Number(body.semester);
  body.cgpa = body.cgpa === '' ? null : Number(body.cgpa);
  try {
    await api(id ? `/api/admin/students/${id}` : '/api/admin/students', body, id ? 'PUT' : 'POST');
    toast(id ? 'Student details updated.' : 'Student account created and setup email sent.');
    paging.page = 1;
    adminStudents();
  } catch (err) { studentForm(id, err.message); }
}
const deleteStudent = safe(async (id) => {
  if (!window.confirm('Permanently delete this student, their requests, and saved date sheet?')) return;
  await api(`/api/admin/students/${id}`, null, 'DELETE');
  toast('Student deleted.');
  adminStudents();
});
const sendSetupEmail = safe(async (id) => {
  await api(`/api/admin/students/${id}/setup-email`, {}, 'POST');
  toast('Password setup email sent.');
});

const adminAssign = safe(async (id, message) => {
  const d = await api('/api/admin/students/' + id);
  const n = d.assigned.length;
  const meter = [1, 2, 3, 4, 5, 6].map(i => `<span style="flex:1;height:8px;border-radius:4px;background:${i <= n ? 'var(--teal)' : (i === 4 ? '#FBEBCB' : '#EDEAE0')}"></span>`).join('');
  show(adminFrame('students', `
    <a onclick="adminStudents()">Back to students</a>
    <div><h1>Assign courses</h1><p class="k">Each student needs 4 to 6 courses. Changes lock once the student saves a date sheet.</p></div>
    ${message ? `<p class="error">${esc(message)}</p>` : ''}
    <div class="row" style="align-items:flex-start;gap:20px">
      <div class="c stack" style="flex:1 1 260px;max-width:330px">
        <div><b style="font-size:18px">${esc(d.student.name)}</b><div class="k">${esc(d.student.reg)} | ${esc(d.student.program)}, Semester ${d.student.semester}</div></div>
        <div><div class="row k"><b>Courses assigned</b><b>${n} of 6</b></div><div style="display:flex;gap:4px;margin-top:6px">${meter}</div></div>
        ${n < 4 ? `<div class="banner"><b>Assignment incomplete.</b> Add at least ${4 - n} more before this student can pick exam dates.</div>` : ''}
        ${d.locked ? '<div class="banner bad">Date sheet saved: assignments are locked until you approve a change request.</div>' : ''}
      </div>
      <div class="stack" style="flex:2 1 400px;min-width:0">
        <div class="c"><h2 style="font-size:17px">Assigned courses</h2>${d.assigned.map(c => `
          <div class="row" style="padding:10px 0;border-bottom:1px solid #EFEBE0"><div><b>${esc(c.code)}</b> ${esc(c.title)}<div class="k">${c.credits} credit hours</div></div>
          <button class="b o s" onclick="changeAssign(${id}, 'unassign', ${c.id})">Remove</button></div>`).join('') || '<p class="k">No courses yet.</p>'}</div>
        <div class="c"><h2 style="font-size:17px">Add a course</h2>${d.available.map(c => `
          <div class="row" style="padding:10px 0;border-bottom:1px solid #EFEBE0"><div><b>${esc(c.code)}</b> ${esc(c.title)}<div class="k">${c.credits} credit hours</div></div>
          <button class="b s" onclick="changeAssign(${id}, 'assign', ${c.id})">Assign</button></div>`).join('') || '<p class="k">All courses are assigned.</p>'}</div>
      </div></div>`));
});

async function changeAssign(id, action, courseId) {
  try { await api(`/api/admin/students/${id}/${action}`, { course_id: courseId }); toast('Course assignment updated.'); adminAssign(id); }
  catch (e) { adminAssign(id, e.message); }
}

let reqState = { status: '', type: '', page: 1, size: 10 };
const adminRequests = safe(async () => {
  const d = await api('/api/admin/requests?' + new URLSearchParams(reqState));
  reqState.page = d.page;
  const from = d.total ? (d.page - 1) * d.size + 1 : 0, to = Math.min(d.page * d.size, d.total);
  const opts = (cur, vals) => vals.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
  show(adminFrame('requests', `<div><h1>Change requests</h1><p class="k">Approving unlocks the action for the student, one time only.</p></div>
    <div class="row" style="justify-content:flex-start">
      <select aria-label="Filter requests by status" onchange="reqState.status = this.value; reqState.page = 1; adminRequests()">${opts(reqState.status, [['', 'All statuses'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']])}</select>
      <select aria-label="Filter requests by type" onchange="reqState.type = this.value; reqState.page = 1; adminRequests()">${opts(reqState.type, [['', 'All types'], ['branch', 'Change branch'], ['sheet', 'Change date sheet']])}</select></div>
    <div class="tw"><table><thead><tr><th scope="col">Student</th><th scope="col">Type</th><th scope="col">Reason</th><th scope="col">Raised</th><th scope="col">Status</th><th scope="col">Decision</th></tr></thead><tbody>` +
    (d.items.map(r => `<tr><td data-label="Student"><b>${esc(r.student_name)}</b></td><td data-label="Type">${r.type === 'branch' ? 'Change branch' : 'Change date sheet'}</td><td data-label="Reason">${esc(r.reason)}</td><td data-label="Raised">${esc(r.raised)}</td>
      <td data-label="Status"><span class="t ${r.status === 'approved' ? 'g' : r.status === 'rejected' ? 'r' : 'a'}">${r.status}</span></td>
      <td data-label="Decision">${r.status === 'pending' ? `<input id="rm-${r.id}" aria-label="Admin remark for ${esc(r.student_name)}" placeholder="Remark (optional)">
        <button class="b s" onclick="decide(${r.id}, 'approved')">Approve</button> <button class="b o s" onclick="decide(${r.id}, 'rejected')">Reject</button>` : esc(r.remark || '-')}</td></tr>`).join('')
      || '<tr><td colspan="6" class="k">No requests.</td></tr>') + `</tbody></table></div>
    <div class="row k"><span>Showing ${from} to ${to} of ${d.total}</span>
      <span><button class="b o s" ${d.page <= 1 ? 'disabled' : ''} onclick="reqState.page--; adminRequests()">Previous</button>
        Page ${d.page} of ${d.pages}
        <button class="b o s" ${d.page >= d.pages ? 'disabled' : ''} onclick="reqState.page++; adminRequests()">Next</button></span></div>`));
});
const decide = safe(async (id, status) => {
  const action = status === 'approved' ? 'approve' : 'reject';
  if (!window.confirm(`Are you sure you want to ${action} this change request?`)) return;
  await api(`/api/admin/requests/${id}/decide`, { status, remark: $('#rm-' + id).value });
  toast(`Request ${status}.`);
  adminRequests();
});

// ================= STUDENT =================
// After login the student lands on whichever step is next.
const studentHome = safe(async () => {
  me = await api('/api/student/me');
  if (me.canChooseBranch) return viewBranch();
  if (!me.assignmentComplete) return viewIncomplete();
  if (me.canEditSheet) { choices = Object.fromEntries(me.sheetChoices.map(c => [c.course_id, c.slot_id])); return viewDesign(); }
  viewSheet();
});

function viewIncomplete() {
  show(studentFrame(2, `<div class="c"><h1>Assignment incomplete</h1>
    <p class="k">You have ${me.courses.length} course(s). You need at least 4 before you can pick exam dates. Please contact the administration.</p></div>`));
}

function viewBranch(message) {
  const current = me.branch ? me.branch.id : null;
  show(studentFrame(1, `<div><h1>Where will you sit your exams?</h1><p class="k">Pick the campus where you will take all your papers.</p></div>
    <div class="banner"><b>You can choose only once.</b> Changing it later needs a request that the admin must approve.</div>
    <div class="stack" style="gap:12px">${me.branches.map(b => `
      <label class="opt ${current === b.id ? 'on' : ''}"><input type="radio" name="branch" value="${b.id}" ${current === b.id ? 'checked' : ''} onchange="pickBranch(${b.id})">
        <div><b>${esc(b.name)}</b> <span class="k">${esc(b.code)}</span><div class="k">${esc(b.city)} | ${esc(b.address)}</div></div></label>`).join('')}</div>
    <p id="branch-error" class="error">${esc(message || '')}</p>
    <div class="row"><span class="k" id="branch-note">${current ? 'Selected: ' + esc(me.branch.name) : 'Nothing selected yet'}</span>
      <button id="branch-save" class="b" ${current ? '' : 'disabled'} onclick="saveBranch()">Confirm branch</button></div>`));
}
let pickedBranch = null;
function pickBranch(id) {
  pickedBranch = id;
  document.querySelectorAll('.opt').forEach(o => o.classList.toggle('on', o.querySelector('input').checked));
  $('#branch-save').disabled = false;
  $('#branch-note').textContent = 'Selected: ' + me.branches.find(b => b.id === id).name;
}
async function saveBranch() {
  const id = pickedBranch || (me.branch && me.branch.id);
  if (!id || !window.confirm('Once confirmed, your branch is locked unless an administrator approves a change request. Continue?')) return;
  try { await api('/api/student/branch', { branch_id: id }); pickedBranch = null; toast('Exam branch confirmed and locked.'); studentHome(); }
  catch (e) { $('#branch-error').textContent = e.message; }
}

// The student's chosen slot objects, used for the live clash check.
const chosenSlot = (c) => c.slots.find(s => s.id === choices[c.id]);
function clashingIds() {
  const ids = new Set(), picked = me.courses.filter(chosenSlot);
  picked.forEach((a, i) => picked.slice(i + 1).forEach(b => {
    const x = chosenSlot(a), y = chosenSlot(b);
    if (x.date === y.date && x.start < y.end && y.start < x.end) { ids.add(a.id); ids.add(b.id); }
  }));
  return ids;
}

function viewDesign(message) {
  const p = me.profile, clash = clashingIds(), chosen = me.courses.filter(chosenSlot).length, total = me.courses.length;
  const names = me.courses.filter(c => clash.has(c.id)).map(c => c.code).join(' and ');
  const rows = me.courses.map(c => {
    const s = chosenSlot(c), dates = [...new Set(c.slots.map(x => x.date))];
    const times = s ? c.slots.filter(x => x.date === s.date) : [];
    const state = clash.has(c.id) ? ['Clash', '#9B2316'] : s ? ['Chosen', '#17603B'] : ['Needed', '#7A4A07'];
    return `<div class="cr ${clash.has(c.id) ? 'bad' : ''}"><div class="name"><b>${esc(c.code)}</b> ${esc(c.title)}<div class="k">${c.credits} credit hours</div></div>
      <select aria-label="${esc(c.code)} exam date" onchange="pickDate(${c.id}, this.value)"><option value="">Choose date</option>${dates.map(d => `<option value="${d}" ${s && s.date === d ? 'selected' : ''}>${dayShort(d)}</option>`).join('')}</select>
      <select aria-label="${esc(c.code)} exam time" onchange="pickTime(${c.id}, this.value)" ${s ? '' : 'disabled'}>${times.map(t => `<option value="${t.id}" ${t.id === choices[c.id] ? 'selected' : ''}>${range(t)}</option>`).join('') || '<option>Choose time</option>'}</select>
      <b style="color:${state[1]};font-size:13px;width:60px">${state[0]}</b></div>`;
  }).join('');
  show(studentFrame(2, `
    <div class="c cols">
      <div><div class="k">PERSONAL</div><b>${esc(p.name)}</b><div class="k">${esc(p.gender)} | ${esc(p.dob)} | ${esc(p.phone)}</div></div>
      <div><div class="k">GUARDIAN</div><b>${esc(p.guardian.name)}</b><div class="k">${esc(p.guardian.occupation)} | ${esc(p.guardian.phone)}</div></div>
      <div><div class="k">ACADEMIC</div><b>${esc(p.academic.program)}, Sem ${p.academic.semester}</b><div class="k">${esc(p.academic.reg)} | Batch ${p.academic.batch} | CGPA ${p.academic.cgpa}</div></div>
      <div><div class="k">EXAM BRANCH</div><b>${esc(me.branch.name)}</b><div class="k">Locked after saving</div></div></div>
    ${clash.size ? `<div class="banner bad" role="alert" aria-live="assertive"><b>Schedule overlap detected.</b> ${esc(names)} have overlapping exam times. Choose another slot to continue.</div>` : ''}
    ${message ? `<div class="banner bad">${esc(message)}</div>` : ''}
    <div class="c"><h2>Choose a date and time for each course</h2>
      <p class="k">Select one slot for every course. Once saved, changes need admin approval.</p>${rows}</div>
    <div class="row"><span class="k" aria-live="polite">${chosen} of ${total} courses scheduled${clash.size ? ' — resolve the overlap to continue' : ''}</span>
      <button class="b" type="button" aria-disabled="${chosen < total || !!clash.size}" ${chosen < total || clash.size ? 'disabled' : ''} onclick="saveSheet()">Save &amp; lock date sheet</button></div>`));
}
function pickDate(courseId, date) {
  const c = me.courses.find(c => c.id === courseId);
  if (date) choices[courseId] = c.slots.find(s => s.date === date).id; else delete choices[courseId];
  viewDesign();
}
function pickTime(courseId, slotId) { choices[courseId] = Number(slotId); viewDesign(); }

const saveSheet = safe(async () => {
  if (!window.confirm(`You have selected a slot for all ${me.courses.length} courses. Saving will lock your date sheet. Continue?`)) return;
  try {
    await api('/api/student/sheet', { choices: me.courses.map(c => ({ course_id: c.id, slot_id: choices[c.id] })) });
    toast('Date sheet saved and locked.');
    studentHome();
  } catch (e) { viewDesign(e.message); }
});

function viewSheet(message) {
  const p = me.profile;
  const label = { pending: 'a', approved: 'g', rejected: 'r' };
  show(studentFrame(3, `
    <div class="row"><div><h1>Your date sheet</h1><p class="k">Saved and locked. Need a change? Ask for help below.</p></div>
      <button class="b noprint" onclick="window.print()">Print date sheet</button></div>
    <div class="c sheet"><div style="text-align:center;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:14px">
      <div class="k" style="letter-spacing:.08em">VIRTUAL UNIVERSITY</div><h2>Examination Date Sheet</h2></div>
      <div class="cols" style="margin-bottom:16px"><div><div class="k">Student</div><b>${esc(p.name)}</b></div><div><div class="k">Registration no.</div><b>${esc(p.academic.reg)}</b></div>
        <div><div class="k">Program</div><b>${esc(p.academic.program)}</b></div><div><div class="k">Semester</div><b>${esc(p.academic.semester)}</b></div><div><div class="k">Exam branch</div><b>${esc(me.branch.name)}</b></div></div>
      <div class="tw" style="border:0"><table><thead><tr><th scope="col">Course code</th><th scope="col">Course title</th><th scope="col">Date</th><th scope="col">Day</th><th scope="col">Time</th></tr></thead><tbody>` +
      me.sheet.map(r => `<tr><td data-label="Course code"><b>${esc(r.course.code)}</b></td><td data-label="Course title">${esc(r.course.title)}</td><td data-label="Date">${esc(r.slot.date)}</td><td data-label="Day">${dayLong(r.slot.date).split(',')[0]}</td><td data-label="Time">${range(r.slot)}</td></tr>`).join('') + `</tbody></table></div></div>
    <div class="c noprint"><div class="row"><h2 style="font-size:17px">Need help?</h2>
      <span><button class="b o s" onclick="helpForm('branch')">Request branch change</button> <button class="b o s" onclick="helpForm('sheet')">Request date sheet change</button></span></div>
      <div id="help-form"></div>${message ? `<p class="error">${esc(message)}</p>` : ''}
      ${me.requests.map(r => `<div class="row" style="padding:12px 0;border-top:1px solid #EFEBE0;font-size:14px"><div><b>${r.type === 'branch' ? 'Branch change' : 'Date sheet change'}</b>
        <div class="k">Raised ${esc(r.raised)} | "${esc(r.reason)}"${r.remark ? ' | Admin remark: "' + esc(r.remark) + '"' : ''}</div></div><span class="t ${label[r.status]}">${r.status}</span></div>`).join('')}</div>`));
}
function helpForm(type) {
  $('#help-form').innerHTML = `<div class="stack help-form"><label for="reason">Why do you need this change?
      <textarea id="reason" rows="3" maxlength="500" aria-describedby="reason-count" placeholder="Explain what needs to change (at least 5 characters)."></textarea></label>
    <div class="row"><span id="reason-count" class="char-count" aria-live="polite">0 / 500</span><button class="b s" onclick="sendRequest('${type}')">Submit request</button></div></div>`;
  $('#reason').addEventListener('input', () => { $('#reason-count').textContent = `${$('#reason').value.length} / 500`; });
}
const sendRequest = safe(async (type) => {
  try {
    if (!window.confirm('Submit this change request to the administration?')) return;
    await api('/api/student/requests', { type, reason: $('#reason').value });
    me = await api('/api/student/me');
    toast('Change request submitted.');
    viewSheet();
  }
  catch (e) { me = await api('/api/student/me'); viewSheet(e.message); }
});

// ---------- start ----------
if (user && localStorage.getItem('exam_token')) start();
