const twilio = require('twilio');

let client;

function getClient() {
  if (!client) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');
    }
    client = twilio(accountSid, authToken);
  }
  return client;
}

const VERIFY_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

// SMS codes only to Romanian and UAE mobiles (2026-10-06): a public route that sends an SMS to any number in the
// world, limited only per number, is the "SMS pumping" fraud pattern. client.4pro.io also limits per visitor.
const SMS_ALLOWED = [/^\+407\d{8}$/, /^\+9715\d{8}$/];

function smsAllowed(phoneNumber) {
  return SMS_ALLOWED.some((r) => r.test(String(phoneNumber || '')));
}

async function sendOTP(phoneNumber) {
  if (!smsAllowed(phoneNumber)) {
    const err = new Error('SMS codes are sent only to Romanian (+40) and UAE (+971) mobiles');
    err.code = 'SMS_COUNTRY_NOT_ALLOWED';
    throw err;
  }
  return getClient().verify.v2
    .services(VERIFY_SID)
    .verifications.create({ to: phoneNumber, channel: 'sms' });
}

async function verifyOTP(phoneNumber, code) {
  return getClient().verify.v2
    .services(VERIFY_SID)
    .verificationChecks.create({ to: phoneNumber, code });
}

module.exports = { sendOTP, verifyOTP, smsAllowed };
