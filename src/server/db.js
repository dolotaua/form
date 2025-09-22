import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.resolve(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(dataDir, 'app.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    company TEXT,
    geography TEXT,
    tech_metrics TEXT,
    is_draw_eligible INTEGER DEFAULT 0,
    sms_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS phone_otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    verified_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_phone_otps_phone ON phone_otps(phone);
`);

const insertSubmissionStmt = db.prepare(`
  INSERT INTO submissions (
    first_name,
    last_name,
    phone,
    email,
    company,
    geography,
    tech_metrics,
    is_draw_eligible,
    sms_verified,
    created_at,
    updated_at
  ) VALUES (
    @first_name,
    @last_name,
    @phone,
    @email,
    @company,
    @geography,
    @tech_metrics,
    @is_draw_eligible,
    @sms_verified,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
`);

const findSubmissionByPhoneStmt = db.prepare(`
  SELECT * FROM submissions WHERE phone = ?
`);

const updateSubmissionVerificationStmt = db.prepare(`
  UPDATE submissions
  SET sms_verified = 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE phone = ?
`);

const insertOtpStmt = db.prepare(`
  INSERT INTO phone_otps (
    phone,
    otp_code,
    expires_at,
    verified_at,
    created_at
  ) VALUES (
    @phone,
    @otp_code,
    @expires_at,
    NULL,
    CURRENT_TIMESTAMP
  )
`);

const findLatestOtpStmt = db.prepare(`
  SELECT *
  FROM phone_otps
  WHERE phone = ?
  ORDER BY datetime(created_at) DESC
  LIMIT 1
`);

const markOtpVerifiedStmt = db.prepare(`
  UPDATE phone_otps
  SET verified_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

export function createSubmission({ firstName, lastName, phone, email, company, geography, techMetrics }) {
  const existing = findSubmissionByPhone(phone);
  if (existing) {
    const error = new Error('Submission with this phone already exists');
    error.code = 'PHONE_EXISTS';
    throw error;
  }

  const payload = {
    first_name: firstName,
    last_name: lastName,
    phone,
    email,
    company: company || null,
    geography: geography || null,
    tech_metrics:
      techMetrics === null || techMetrics === undefined
        ? null
        : typeof techMetrics === 'string'
        ? techMetrics
        : JSON.stringify(techMetrics),
    is_draw_eligible: 1,
    sms_verified: 0
  };

  insertSubmissionStmt.run(payload);
  return findSubmissionByPhone(phone);
}

export function findSubmissionByPhone(phone) {
  return findSubmissionByPhoneStmt.get(phone);
}

export function markSubmissionSmsVerified(phone) {
  return updateSubmissionVerificationStmt.run(phone);
}

export function createOtp({ phone, otpCode, expiresAt }) {
  const info = insertOtpStmt.run({
    phone,
    otp_code: otpCode,
    expires_at: expiresAt
  });
  return info.lastInsertRowid;
}

export function findLatestOtp(phone) {
  return findLatestOtpStmt.get(phone);
}

export function markOtpVerified(id) {
  return markOtpVerifiedStmt.run(id);
}

export default db;
