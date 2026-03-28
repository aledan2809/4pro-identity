// E.164 phone format: + followed by 1-15 digits
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

function isValidE164(phone) {
  return typeof phone === 'string' && E164_REGEX.test(phone);
}

function sanitizePhone(phone) {
  if (typeof phone !== 'string') return '';
  return phone.replace(/[^\d+]/g, '');
}

module.exports = { isValidE164, sanitizePhone };
