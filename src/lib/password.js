const bcrypt = require('bcrypt');

const COST_FACTOR = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, COST_FACTOR);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = { hashPassword, verifyPassword };
