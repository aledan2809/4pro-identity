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

async function sendOTP(phoneNumber) {
  return getClient().verify.v2
    .services(VERIFY_SID)
    .verifications.create({ to: phoneNumber, channel: 'sms' });
}

async function verifyOTP(phoneNumber, code) {
  return getClient().verify.v2
    .services(VERIFY_SID)
    .verificationChecks.create({ to: phoneNumber, code });
}

module.exports = { sendOTP, verifyOTP };
