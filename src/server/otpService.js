import crypto from 'crypto';
import { logEvent } from './logger.js';

const OTP_LENGTH = parseInt(process.env.OTP_LENGTH || '6', 10);
const OTP_TTL_MS = parseInt(process.env.OTP_TTL_MS || `${5 * 60 * 1000}`, 10);

export function generateOtp() {
  const max = 10 ** OTP_LENGTH;
  const code = crypto.randomInt(0, max).toString().padStart(OTP_LENGTH, '0');
  return code;
}

export async function sendOtpViaProvider(phone, code) {
  // Placeholder for actual SMS provider integration
  logEvent('otp_sent', { phone, code });
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.info(`OTP for ${phone}: ${code}`);
  }
}

export function getOtpExpiryDate() {
  return new Date(Date.now() + OTP_TTL_MS);
}

export function isOtpExpired(otpRecord) {
  if (!otpRecord) return true;
  return Date.now() > new Date(otpRecord.expires_at).getTime();
}
