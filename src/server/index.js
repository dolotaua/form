import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';

import {
  createSubmission,
  findSubmissionByPhone,
  markSubmissionSmsVerified,
  createOtp,
  findLatestOtp,
  markOtpVerified
} from './db.js';
import { logEvent } from './logger.js';
import {
  generateOtp,
  sendOtpViaProvider,
  getOtpExpiryDate,
  isOtpExpired
} from './otpService.js';

const app = express();
const port = process.env.PORT || 4000;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan('combined'));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`, 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

const csrfProtection = csrf({
  cookie: {
    key: process.env.CSRF_COOKIE_NAME || '_csrf',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
});

const apiRouter = express.Router();

function parseStoredTechMetrics(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    return rawValue;
  }
}

function serializeSubmission(record) {
  if (!record) return null;
  return {
    id: record.id,
    firstName: record.first_name,
    lastName: record.last_name,
    phone: record.phone,
    email: record.email,
    company: record.company,
    geography: record.geography,
    techMetrics: parseStoredTechMetrics(record.tech_metrics),
    isDrawEligible: Boolean(record.is_draw_eligible),
    smsVerified: Boolean(record.sms_verified),
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

apiRouter.get('/csrf-token', csrfProtection, (req, res) => {
  res.json({ token: req.csrfToken() });
});

apiRouter.use(csrfProtection);

apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

apiRouter.post('/feedback', (req, res, next) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      email,
      company,
      geography,
      techMetrics
    } = req.body;

    if (!firstName || !lastName || !phone || !email) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const normalizedPhone = String(phone).trim();
    const sanitizedTechMetrics =
      techMetrics === null || techMetrics === undefined
        ? null
        : typeof techMetrics === 'string'
        ? techMetrics
        : JSON.stringify(techMetrics);

    const submission = createSubmission({
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      phone: normalizedPhone,
      email: String(email).trim(),
      company: company ? String(company).trim() : null,
      geography: geography ? String(geography).trim() : null,
      techMetrics: sanitizedTechMetrics
    });

    logEvent('feedback_submitted', {
      submissionId: submission.id,
      phone: normalizedPhone
    });

    return res.status(201).json({
      message: 'Feedback saved',
      submission: serializeSubmission(submission)
    });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post('/send-otp', async (req, res, next) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: 'Phone is required' });
    }

    const normalizedPhone = String(phone).trim();
    const submission = findSubmissionByPhone(normalizedPhone);

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found for phone' });
    }

    const latestOtp = findLatestOtp(normalizedPhone);
    if (latestOtp && !isOtpExpired(latestOtp)) {
      return res.status(429).json({ message: 'OTP already sent. Please wait before requesting another code.' });
    }

    const otpCode = generateOtp();
    const expiresAt = getOtpExpiryDate();

    createOtp({
      phone: normalizedPhone,
      otpCode,
      expiresAt: expiresAt.toISOString()
    });

    await sendOtpViaProvider(normalizedPhone, otpCode);

    logEvent('otp_requested', {
      submissionId: submission.id,
      phone: normalizedPhone
    });

    return res.json({
      message: 'OTP sent',
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post('/verify-otp', (req, res, next) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Phone and code are required' });
    }

    const normalizedPhone = String(phone).trim();
    const latestOtp = findLatestOtp(normalizedPhone);

    if (!latestOtp) {
      return res.status(400).json({ message: 'OTP not found' });
    }

    if (isOtpExpired(latestOtp)) {
      return res.status(400).json({ message: 'OTP expired' });
    }

    if (String(code).trim() !== latestOtp.otp_code) {
      return res.status(400).json({ message: 'Invalid OTP code' });
    }

    markOtpVerified(latestOtp.id);
    markSubmissionSmsVerified(normalizedPhone);

    logEvent('otp_verified', {
      phone: normalizedPhone,
      otpId: latestOtp.id
    });

    return res.json({ message: 'Phone verified' });
  } catch (error) {
    return next(error);
  }
});

app.use('/api', apiRouter);

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ message: 'Invalid CSRF token' });
  }

  if (err.code === 'PHONE_EXISTS') {
    return res.status(409).json({ message: 'Phone number already submitted' });
  }

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ message: 'CORS policy does not allow this origin' });
  }

  // eslint-disable-next-line no-console
  console.error('Unexpected server error', err);
  return res.status(500).json({ message: 'Unexpected server error' });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Feedback server listening on port ${port}`);
});
