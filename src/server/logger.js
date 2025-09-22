import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logDir = path.resolve(__dirname, 'data');
fs.mkdirSync(logDir, { recursive: true });
const logPath = path.resolve(logDir, 'events.log');

export function logEvent(type, payload = {}) {
  const entry = {
    type,
    timestamp: new Date().toISOString(),
    payload
  };

  fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to write log entry', err);
    }
  });
}

export function getLogPath() {
  return logPath;
}
