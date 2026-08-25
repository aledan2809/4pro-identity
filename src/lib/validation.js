// E.164 phone format: + followed by 1-15 digits
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

function isValidE164(phone) {
  return typeof phone === 'string' && E164_REGEX.test(phone);
}

function sanitizePhone(phone) {
  if (typeof phone !== 'string') return '';
  return phone.replace(/[^\d+]/g, '');
}

// Email is compared case-insensitively everywhere: uniqueness in Postgres is
// exact, so storing `Foo@x.com` next to `foo@x.com` silently creates two
// identities for one person — the orphan class L79 exists to close.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

module.exports = { isValidE164, sanitizePhone, isValidEmail, normalizeEmail };
