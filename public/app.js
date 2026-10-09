// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dayShort = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
const dayLong = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
const to12 = (t) => { const [h, m] = t.split(':').map(Number); return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const range = (s) => (s.end ? `${to12(s.start)} to ${to12(s.end)}` : to12(s.start));
const show = (html) => { $('#page').innerHTML = html; };

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
  const link = (id, label, fn) => `<a class="${active === id ? 'on' : ''}" onclick="${fn}()">${label}</a>`;
  return `<div class="admin"><aside class="side"><div class="brand">ExamSlot <small>Admin</small></div>
    <nav class="nav">${link('students', 'Students', 'adminStudents')}${link('requests', 'Requests', 'adminRequests')}</nav>
    <button class="b o s" style="margin-top:auto" onclick="logout()">Sign out</button></aside><main class="main">${inner}</main></div>`;
}
function studentFrame(step, inner) {
  const s = (n, label) => `<div><span class="dot ${step >= n ? 'on' : ''}">${step > n ? '&#10003;' : n}</span>${step === n ? `<b>${label}</b>` : label}</div>`;
  return `<header class="top"><div class="brand">ExamSlot</div>
      <div>${esc(user.name)} <a style="margin-left:12px" onclick="logout()">Sign out</a></div></header>
    <div class="wrap"><div class="steps">${s(1, 'Choose branch')}${s(2, 'Pick dates')}${s(3, 'Print date sheet')}</div>${inner}</div>`;
}

// ================= ADMIN =================
const adminStudents = safe(async () => {
  show(adminFrame('students', `
    <div class="row"><div><h1>Students</h1><p class="k">Search and pages are handled by the server.</p></div></div>
    <input id="search" type="search" placeholder="Search name, email or registration number" value="${esc(paging.search)}"
      oninput="clearTimeout(timer); timer = setTimeout(() => { paging.search = this.value; paging.page = 1; loadStudents(); }, 250)">
    <div id="tbl"></div>`));
  await loadStudents();
});

const loadStudents = safe(async () => {
  const q = new URLSearchParams(paging);
  const d = await api('/api/admin/students?' + q);
  paging.page = d.page;
  const from = d.total ? (d.page - 1) * d.size + 1 : 0, to = Math.min(d.page * d.size, d.total);
  $('#tbl').innerHTML = `<div class="tw"><table><tr><th>Student</th><th>Program</th><th>Courses</th><th>Branch</th><th>Date sheet</th><th></th></tr>` +
    (d.items.map(s => `<tr>
      <td><b>${esc(s.name)}</b><div class="k">${esc(s.reg)} | ${esc(s.email)}</div></td><td>${esc(s.program)}, Sem ${s.semester}</td>
      <td><span class="t ${s.course_count < 4 ? 'a' : 'g'}">${s.course_count < 4 ? 'Incomplete: ' + s.course_count : s.course_count + ' of 6'}</span></td>
      <td>${esc(s.branch)}</td><td><span class="t ${s.sheet === 'Saved' ? 'g' : ''}">${esc(s.sheet)}</span></td>
      <td><a onclick="adminAssign(${s.id})">Assign courses</a></td></tr>`).join('') ||
      '<tr><td colspan="6" class="k">No students match your search.</td></tr>') + `</table></div>
    <div class="row k"><span>Showing ${from} to ${to} of ${d.total}</span>
      <span><select onchange="paging.size = Number(this.value); paging.page = 1; loadStudents()">${[5, 10].map(n => `<option ${d.size === n ? 'selected' : ''} value="${n}">${n} per page</option>`).join('')}</select>
        <button class="b o s" ${d.page <= 1 ? 'disabled' : ''} onclick="paging.page--; loadStudents()">Previous</button>
        Page ${d.page} of ${d.pages}
        <button class="b o s" ${d.page >= d.pages ? 'disabled' : ''} onclick="paging.page++; loadStudents()">Next</button></span></div>`;
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
  try { await api(`/api/admin/students/${id}/${action}`, { course_id: courseId }); adminAssign(id); }
  catch (e) { adminAssign(id, e.message); }
}

let reqState = { status: '', type: '', page: 1, size: 10 };
const adminRequests = safe(async () => {
  const d = await api('/api/admin/requests?' + new URLSearchParams(reqState));
  reqState.page = d.page;
  const from = d.total ? (d.page - 1) * d.size + 1 : 0, to = Math.min(d.page * d.size, d.total);
  const opts = (cur, vals) => vals.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
  show(adminFrame('requests', `<div><h1>Requests</h1><p class="k">Approving unlocks the action for the student, one time only.</p></div>
    <div class="row" style="justify-content:flex-start">
      <select onchange="reqState.status = this.value; reqState.page = 1; adminRequests()">${opts(reqState.status, [['', 'All statuses'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']])}</select>
      <select onchange="reqState.type = this.value; reqState.page = 1; adminRequests()">${opts(reqState.type, [['', 'All types'], ['branch', 'Change branch'], ['sheet', 'Change date sheet']])}</select></div>
    <div class="tw"><table><tr><th>Student</th><th>Type</th><th>Reason</th><th>Raised</th><th>Status</th><th>Decision</th></tr>` +
    (d.items.map(r => `<tr><td><b>${esc(r.student_name)}</b></td><td>${r.type === 'branch' ? 'Change branch' : 'Change date sheet'}</td><td>${esc(r.reason)}</td><td>${esc(r.raised)}</td>
      <td><span class="t ${r.status === 'approved' ? 'g' : r.status === 'rejected' ? 'r' : 'a'}">${r.status}</span></td>
      <td>${r.status === 'pending' ? `<input id="rm-${r.id}" placeholder="Remark (optional)" style="width:150px">
        <button class="b s" onclick="decide(${r.id}, 'approved')">Approve</button> <button class="b o s" onclick="decide(${r.id}, 'rejected')">Reject</button>` : esc(r.remark || '-')}</td></tr>`).join('')
      || '<tr><td colspan="6" class="k">No requests.</td></tr>') + `</table></div>
    <div class="row k"><span>Showing ${from} to ${to} of ${d.total}</span>
      <span><button class="b o s" ${d.page <= 1 ? 'disabled' : ''} onclick="reqState.page--; adminRequests()">Previous</button>
        Page ${d.page} of ${d.pages}
        <button class="b o s" ${d.page >= d.pages ? 'disabled' : ''} onclick="reqState.page++; adminRequests()">Next</button></span></div>`));
});
const decide = safe(async (id, status) => {
  await api(`/api/admin/requests/${id}/decide`, { status, remark: $('#rm-' + id).value });
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
  try { await api('/api/student/branch', { branch_id: id }); pickedBranch = null; studentHome(); }
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
      <select onchange="pickDate(${c.id}, this.value)"><option value="">Choose date</option>${dates.map(d => `<option value="${d}" ${s && s.date === d ? 'selected' : ''}>${dayShort(d)}</option>`).join('')}</select>
      <select onchange="pickTime(${c.id}, this.value)" ${s ? '' : 'disabled'}>${times.map(t => `<option value="${t.id}" ${t.id === choices[c.id] ? 'selected' : ''}>${range(t)}</option>`).join('') || '<option>Choose time</option>'}</select>
      <b style="color:${state[1]};font-size:13px;width:60px">${state[0]}</b></div>`;
  }).join('');
  show(studentFrame(2, `
    <div class="c cols">
      <div><div class="k">PERSONAL</div><b>${esc(p.name)}</b><div class="k">${esc(p.gender)} | ${esc(p.dob)} | ${esc(p.phone)}</div></div>
      <div><div class="k">GUARDIAN</div><b>${esc(p.guardian.name)}</b><div class="k">${esc(p.guardian.occupation)} | ${esc(p.guardian.phone)}</div></div>
      <div><div class="k">ACADEMIC</div><b>${esc(p.academic.program)}, Sem ${p.academic.semester}</b><div class="k">${esc(p.academic.reg)} | Batch ${p.academic.batch} | CGPA ${p.academic.cgpa}</div></div>
      <div><div class="k">EXAM BRANCH</div><b>${esc(me.branch.name)}</b><div class="k">Locked after saving</div></div></div>
    ${clash.size ? `<div class="banner bad"><b>Time clash.</b> ${esc(names)} are at the same date and time. Pick a different slot for one of them.</div>` : ''}
    ${message ? `<div class="banner bad">${esc(message)}</div>` : ''}
    <div class="c"><h2 style="font-size:18px">Choose a date and time for each course</h2>
      <p class="k">You can save once every course has a slot. After saving, changes need admin approval.</p>${rows}</div>
    <div class="row"><span class="k">${chosen} of ${total} chosen${clash.size ? ' | fix the clash to continue' : ''}</span>
      <button class="b" ${chosen < total || clash.size ? 'disabled' : ''} onclick="saveSheet()">Save date sheet</button></div>`));
}
function pickDate(courseId, date) {
  const c = me.courses.find(c => c.id === courseId);
  if (date) choices[courseId] = c.slots.find(s => s.date === date).id; else delete choices[courseId];
  viewDesign();
}
function pickTime(courseId, slotId) { choices[courseId] = Number(slotId); viewDesign(); }

const saveSheet = safe(async () => {
  try {
    await api('/api/student/sheet', { choices: me.courses.map(c => ({ course_id: c.id, slot_id: choices[c.id] })) });
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
        <div><div class="k">Program</div><b>${esc(p.academic.program)}</b></div><div><div class="k">Exam branch</div><b>${esc(me.branch.name)}</b></div></div>
      <div class="tw" style="border:0"><table><tr><th>Course code</th><th>Course title</th><th>Date</th><th>Day</th><th>Time</th></tr>` +
      me.sheet.map(r => `<tr><td><b>${esc(r.course.code)}</b></td><td>${esc(r.course.title)}</td><td>${esc(r.slot.date)}</td><td>${dayLong(r.slot.date).split(',')[0]}</td><td>${range(r.slot)}</td></tr>`).join('') + `</table></div></div>
    <div class="c noprint"><div class="row"><h2 style="font-size:17px">Need help?</h2>
      <span><button class="b o s" onclick="helpForm('branch')">Request branch change</button> <button class="b o s" onclick="helpForm('sheet')">Request date sheet change</button></span></div>
      <div id="help-form"></div>${message ? `<p class="error">${esc(message)}</p>` : ''}
      ${me.requests.map(r => `<div class="row" style="padding:12px 0;border-top:1px solid #EFEBE0;font-size:14px"><div><b>${r.type === 'branch' ? 'Branch change' : 'Date sheet change'}</b>
        <div class="k">Raised ${esc(r.raised)} | "${esc(r.reason)}"${r.remark ? ' | Admin remark: "' + esc(r.remark) + '"' : ''}</div></div><span class="t ${label[r.status]}">${r.status}</span></div>`).join('')}</div>`));
}
function helpForm(type) {
  $('#help-form').innerHTML = `<div class="stack" style="margin-top:14px"><textarea id="reason" rows="3" placeholder="Why do you need this change?"></textarea>
    <div><button class="b s" onclick="sendRequest('${type}')">Submit request</button></div></div>`;
}
const sendRequest = safe(async (type) => {
  try { await api('/api/student/requests', { type, reason: $('#reason').value }); me = await api('/api/student/me'); viewSheet(); }
  catch (e) { me = await api('/api/student/me'); viewSheet(e.message); }
});

// ---------- start ----------
if (user && localStorage.getItem('exam_token')) start();
