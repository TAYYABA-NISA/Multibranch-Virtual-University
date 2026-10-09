import bcrypt from 'bcryptjs';
import { db } from './db.js';

// Demo data required by the paper: 1 admin, 3 branches, 8 courses, 5 students, slots.
// Admin: admin@examslot.test / admin123. Students: <email> / student123.
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const branches = [
  ['Lahore Campus', 'LHR', 'Lahore', '12 Canal Road', '042 111 000 111'],
  ['Karachi Campus', 'KHI', 'Karachi', '45 University Avenue', '021 111 000 222'],
  ['Islamabad Campus', 'ISB', 'Islamabad', 'Sector H-9', '051 111 000 333'],
];
const courses = [
  ['CS-210', 'Data Structures', 4, 'Computer Science'], ['SE-301', 'Software Design', 3, 'Software Engineering'],
  ['CS-315', 'Database Systems', 3, 'Computer Science'], ['MT-205', 'Discrete Mathematics', 3, 'Mathematics'],
  ['DS-201', 'Data Visualization', 3, 'Data Science'], ['EN-101', 'Technical Writing', 2, 'English'],
  ['CS-330', 'Operating Systems', 4, 'Computer Science'], ['MG-210', 'Project Management', 3, 'Management'],
];
// name, reg no, program, semester, gender, assigned course ids (by position above)
const students = [
  ['Ayesha Khan', 'BC210401', 'BS Computer Science', 5, 'Female', [1, 2, 3, 4, 5]],
  ['Bilal Khan', 'BC210522', 'BS Software Engineering', 3, 'Male', [2, 1, 4]],
  ['Hina Khanzada', 'BC200318', 'BBA', 6, 'Female', [3, 5, 6, 8]],
  ['Usman Ali', 'BC220077', 'BS Data Science', 1, 'Male', [1, 2, 3, 4, 5, 6]],
  ['Sara Malik', 'BC210910', 'BS Computer Science', 5, 'Female', [7, 1, 2, 3]],
];

export function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;
  const adminHash = bcrypt.hashSync('admin123', 10), studentHash = bcrypt.hashSync('student123', 10);

  db.transaction(() => {
    db.prepare("INSERT INTO users (email, password_hash, role) VALUES ('admin@examslot.test', ?, 'admin')").run(adminHash);
    for (const b of branches) db.prepare('INSERT INTO branches (name, code, city, address, phone) VALUES (?, ?, ?, ?, ?)').run(...b);
    for (const c of courses) db.prepare('INSERT INTO courses (code, title, credit_hours, department) VALUES (?, ?, ?, ?)').run(...c);

    // Two slots per course. Several courses share a date and time on purpose, so clashes can be demonstrated.
    courses.forEach((_, i) => {
      const id = i + 1;
      db.prepare('INSERT INTO exam_slots (course_id, date, start_time, end_time) VALUES (?, ?, ?, ?)').run(id, day(10 + (id % 3)), '09:00', '11:00');
      db.prepare('INSERT INTO exam_slots (course_id, date, start_time, end_time) VALUES (?, ?, ?, ?)').run(id, day(14 + (id % 3)), '14:00', '16:00');
    });

    students.forEach(([name, reg, program, semester, gender, assigned], i) => {
      const n = i + 1, last = name.split(' ')[1];
      const email = name.toLowerCase().replace(/ /g, '.') + '@student.edu';
      const userId = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'student')").run(email, studentHash).lastInsertRowid;
      const studentId = db.prepare(`INSERT INTO students
        (user_id, full_name, phone, cnic, dob, gender, address, guardian_name, guardian_cnic, guardian_occupation, guardian_phone, emergency_contact,
         reg_no, program, semester, batch, prev_qualification, prev_institute, cgpa)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2021', 'Intermediate', 'City College', ?)`)
        .run(userId, name, `0300 12345${n}0`, `35202-12345${n}-1`, `2003-03-1${n}`, gender, `House ${n}, Model Town`,
          `Imran ${last}`, `35202-98765${n}-3`, 'Businessman', `0301 76543${n}0`, `0302 55555${n}0`, reg, program, semester, 3 + n / 10).lastInsertRowid;
      for (const courseId of assigned) db.prepare('INSERT INTO student_courses (student_id, course_id) VALUES (?, ?)').run(studentId, courseId);
    });
  })();
  return true;
}

if (process.argv[1]?.endsWith('seed.js')) console.log(seed() ? 'Seeded.' : 'Database already has data.');
