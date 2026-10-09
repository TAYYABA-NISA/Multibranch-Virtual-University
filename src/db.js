import { DatabaseSync } from 'node:sqlite'; // SQLite built into Node 22.13 or newer: nothing to compile or install

// One-file SQLite database. Use DB_FILE=':memory:' for tests. Delete examslot.db to reset.
export const db = new DatabaseSync(process.env.DB_FILE || 'examslot.db');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON'); // makes the database refuse links to rows that do not exist

// db.transaction(fn) returns a function that runs fn all-or-nothing: if anything throws, nothing is saved.
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN');
  try {
    const result = fn(...args);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,                      -- empty until the student sets a password
  role TEXT NOT NULL CHECK (role IN ('admin','student'))
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  credit_hours INTEGER NOT NULL CHECK (credit_hours BETWEEN 1 AND 6),
  department TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  -- personal
  full_name TEXT NOT NULL, phone TEXT, cnic TEXT, dob TEXT, gender TEXT, address TEXT, photo TEXT,
  -- parent or guardian
  guardian_name TEXT, guardian_cnic TEXT, guardian_occupation TEXT, guardian_phone TEXT, emergency_contact TEXT,
  -- academic
  reg_no TEXT NOT NULL UNIQUE, program TEXT, semester INTEGER, batch TEXT,
  prev_qualification TEXT, prev_institute TEXT, cgpa REAL,
  -- exam state
  branch_id INTEGER REFERENCES branches(id),
  branch_unlock INTEGER NOT NULL DEFAULT 0,   -- 1 after the admin approves a branch change, used once
  sheet_unlock INTEGER NOT NULL DEFAULT 0,    -- 1 after the admin approves a date sheet change, used once
  sheet_saved_at TEXT
);

CREATE TABLE IF NOT EXISTS student_courses (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  PRIMARY KEY (student_id, course_id)          -- the same course cannot be assigned twice
);

CREATE TABLE IF NOT EXISTS exam_slots (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  date TEXT NOT NULL,                          -- YYYY-MM-DD
  start_time TEXT NOT NULL,                    -- HH:MM
  end_time TEXT,
  UNIQUE (course_id, date, start_time)         -- no duplicate slot for the same course
);

CREATE TABLE IF NOT EXISTS selections (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  slot_id INTEGER NOT NULL REFERENCES exam_slots(id),
  PRIMARY KEY (student_id, course_id)          -- one slot per course per student
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('branch','sheet')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT
);
-- The database itself refuses a second pending request of the same type
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request ON requests(student_id, type) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS password_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,             -- only a hash is stored, never the token itself
  expires_at TEXT NOT NULL,
  used_at TEXT
);
`);
