const WEBHOOK_URL = (() => {
  const host = document.querySelector('[data-webhook]');
  return host ? host.dataset.webhook : '/api/lead';
})();
const TELEGRAM_USERNAME = 'dolota_manager';
const STORAGE_KEY = 'dolota-visitor';

const state = {
  leadId: generateLeadId(),
  utm: {},
  geo: null,
  tech: collectTech(),
  events: [],
};

function generateLeadId() {
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `lead_${Date.now()}_${randomPart}`;
}

async function buildUtm() {
  const params = new URLSearchParams(window.location.search);
  const utm = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((key) => {
    if (params.has(key)) {
      utm[key] = params.get(key);
    }
  });

  // Capture referrer if present
  if (document.referrer) {
    utm.referrer = document.referrer;
  }

  // Attempt to obtain geolocation
  try {
    const position = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation unavailable'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 60 * 1000,
      });
    });
    utm.geo = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
    state.geo = utm.geo;
  } catch (error) {
    utm.geo_error = error.message;
    console.warn('Geolocation error:', error.message);
  }

  return utm;
}

function collectTech() {
  const nav = window.navigator;
  return {
    userAgent: nav.userAgent,
    language: nav.language,
    languages: nav.languages,
    platform: nav.platform,
    vendor: nav.vendor,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      colorDepth: window.screen.colorDepth,
    },
  };
}

function initBehaviorTracking() {
  const trackable = document.querySelectorAll('[data-track]');
  trackable.forEach((element) => {
    element.addEventListener('click', () => {
      const eventName = element.getAttribute('data-track');
      track(eventName, {
        label: element.textContent.trim(),
        type: element.tagName,
      });
    });
  });
}

function track(eventName, payload = {}) {
  const entry = {
    id: `${eventName}_${Date.now()}`,
    event: eventName,
    payload,
    ts: new Date().toISOString(),
  };
  state.events.push(entry);
  if (navigator.sendBeacon) {
    const beaconPayload = new Blob([JSON.stringify(entry)], {
      type: 'application/json',
    });
    navigator.sendBeacon(`${WEBHOOK_URL}/track`, beaconPayload);
  }
}

async function sendLead(payload) {
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Не вдалося відправити заявку');
  }

  return response.json().catch(() => ({ status: 'ok' }));
}

function showStatus(message, isError = false) {
  const statusElement = document.getElementById('status-message');
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.classList.toggle('status--error', isError);
  statusElement.classList.toggle('status--success', !isError);
}

function setFormDisabled(disabled) {
  const form = document.getElementById('lead-form');
  if (!form) return;
  const elements = Array.from(form.elements);
  elements.forEach((el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLButtonElement) {
      el.disabled = disabled;
    }
  });
}

function validateEmail(email) {
  if (!email) return true; // optional
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(email.trim());
}

function validatePhone(phone) {
  const pattern = /^\+[1-9]\d{7,14}$/;
  return pattern.test(phone.trim());
}

function getFormData() {
  const form = document.getElementById('lead-form');
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  return {
    ...data,
    leadId: state.leadId,
    utm: state.utm,
    tech: state.tech,
    geo: state.geo,
    events: state.events,
    submittedAt: new Date().toISOString(),
  };
}

function rememberVisitor(data) {
  const snapshot = {
    name: data.fullName,
    phone: data.phone,
    email: data.email,
    timestamp: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('Local storage unavailable', error);
  }
}

function restoreVisitor() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const data = JSON.parse(stored);
    if (data.name) document.getElementById('fullName').value = data.name;
    if (data.phone) document.getElementById('phone').value = data.phone;
    if (data.email) document.getElementById('email').value = data.email;
  } catch (error) {
    console.warn('Failed to restore visitor', error);
  }
}

function autoFillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const mapping = {
    fullName: ['name', 'fullname'],
    email: ['email'],
    phone: ['phone', 'tel'],
    company: ['company'],
    message: ['message', 'comment'],
  };
  Object.entries(mapping).forEach(([fieldId, keys]) => {
    const element = document.getElementById(fieldId);
    if (!element) return;
    keys.some((key) => {
      if (params.has(key)) {
        element.value = params.get(key);
        return true;
      }
      return false;
    });
  });
}

async function handleContactPicker() {
  if (!('contacts' in navigator) || !('select' in navigator.contacts)) {
    showStatus('Contact Picker API недоступний у вашому браузері');
    return;
  }
  try {
    const contacts = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: false });
    if (!contacts.length) return;
    const [contact] = contacts;
    if (contact.name && contact.name.length) {
      document.getElementById('fullName').value = contact.name[0];
    }
    if (contact.tel && contact.tel.length) {
      document.getElementById('phone').value = contact.tel[0];
    }
    if (contact.email && contact.email.length) {
      document.getElementById('email').value = contact.email[0];
    }
    showStatus('Контакт додано з адресної книги');
  } catch (error) {
    console.warn('Contact picker error', error);
    showStatus('Не вдалося імпортувати контакт', true);
  }
}

function setupContactPicker() {
  const btn = document.getElementById('contact-picker');
  if (!btn) return;
  btn.addEventListener('click', handleContactPicker);
}

function setupTelegramLink() {
  const link = document.getElementById('telegram-link');
  if (!link) return;
  const baseUrl = `https://t.me/${TELEGRAM_USERNAME}`;
  const params = new URLSearchParams();
  params.set('start', state.leadId);
  link.href = `${baseUrl}?${params.toString()}`;
  link.addEventListener('click', () => track('telegram_click', { leadId: state.leadId }));
}

function setupCatalogCtas() {
  const download = document.getElementById('catalog-download');
  if (download) {
    download.addEventListener('click', () => {
      track('catalog_download', { leadId: state.leadId });
      window.open('/docs/catalog.pdf', '_blank');
    });
  }
  const telegram = document.getElementById('catalog-telegram');
  if (telegram) {
    telegram.addEventListener('click', () => track('catalog_telegram', { leadId: state.leadId }));
  }
}

function openVCard(data) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${data.fullName || 'Гість ДОЛОТА'}`,
    data.company ? `ORG:${data.company}` : '',
    data.phone ? `TEL;TYPE=CELL:${data.phone}` : '',
    data.email ? `EMAIL:${data.email}` : '',
    'END:VCARD',
  ].filter(Boolean);
  const blob = new Blob([lines.join('\n')], { type: 'text/vcard' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${data.fullName || 'contact'}.vcf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function showCatalogSection() {
  const section = document.getElementById('catalog-section');
  if (!section) return;
  section.classList.remove('is-hidden');
}

function initOfflineHandling() {
  const banner = document.getElementById('offline-banner');
  const toggle = () => {
    const offline = !navigator.onLine;
    if (banner) {
      banner.classList.toggle('is-hidden', !offline);
    }
    setFormDisabled(offline);
  };
  window.addEventListener('online', toggle);
  window.addEventListener('offline', toggle);
  toggle();
}

async function initialize() {
  state.utm = await buildUtm();
  initBehaviorTracking();
  autoFillFromUrl();
  restoreVisitor();
  setupContactPicker();
  setupTelegramLink();
  setupCatalogCtas();
  initOfflineHandling();
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const phone = form.phone.value.trim();
  const email = form.email.value.trim();

  if (!validatePhone(phone)) {
    showStatus('Телефон повинен бути у міжнародному форматі, наприклад +380441112233', true);
    track('validation_error', { field: 'phone' });
    return;
  }
  if (!validateEmail(email)) {
    showStatus('Перевірте адресу електронної пошти', true);
    track('validation_error', { field: 'email' });
    return;
  }

  submitButton.disabled = true;
  showStatus('Збираємо дані…');

  try {
    const payload = getFormData();
    showStatus('Надсилаємо заявку…');
    const response = await sendLead(payload);
    showStatus('Заявку надіслано! Наш менеджер скоро звʼяжеться з вами.');
    track('lead_submitted', { leadId: state.leadId, response });
    rememberVisitor(payload);
    openVCard(payload);
    showCatalogSection();
  } catch (error) {
    console.error('Submit error', error);
    showStatus(error.message || 'Сталася помилка під час відправлення', true);
    track('lead_failed', { error: error.message });
  } finally {
    submitButton.disabled = false;
  }
}

function initForm() {
  const form = document.getElementById('lead-form');
  if (!form) return;
  form.addEventListener('submit', handleSubmit);
}

window.addEventListener('DOMContentLoaded', () => {
  initForm();
  initialize();
});

export {
  buildUtm,
  collectTech,
  generateLeadId,
  handleSubmit,
  initBehaviorTracking,
  track,
};
