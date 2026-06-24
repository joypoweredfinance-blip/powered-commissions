const crypto = require('crypto');

function genPassword() {
  return crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
}

module.exports = { genPassword };
