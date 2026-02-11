const crypto = require('crypto');

/**
 * Generate SHA-256 token for TBank API (exact algorithm from TBankService.php)
 *
 * 1. Keep only root-level scalar params (exclude Token, arrays, objects)
 * 2. Add Password
 * 3. Sort by key alphabetically
 * 4. Concatenate only values (no keys, no delimiters)
 * 5. SHA-256 hash
 */
function generateToken(params, password) {
  const tokenParams = {};

  for (const [key, value] of Object.entries(params)) {
    if (key === 'Token') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      tokenParams[key] = String(value);
    }
  }

  tokenParams.Password = password;

  const sorted = Object.keys(tokenParams).sort();
  const concatenated = sorted.map((k) => tokenParams[k]).join('');

  return crypto.createHash('sha256').update(concatenated).digest('hex');
}

/**
 * Verify token from incoming request
 */
function verifyToken(params, password) {
  const received = params.Token;
  if (!received) return false;
  const expected = generateToken(params, password);
  return received === expected;
}

module.exports = { generateToken, verifyToken };
