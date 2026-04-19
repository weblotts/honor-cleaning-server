import crypto from 'crypto';

// ────────────────────────────────────────────────────────────────
// COMPLIANCE: MA 201 CMR 17.00 – Encryption at Rest
// AES-256-CBC field-level encryption for PII (name, phone, address).
// Key is loaded from environment variable, never hardcoded.
// ────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.FIELD_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt a plaintext string. Returns "iv:ciphertext" in hex.
 */
export function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a "iv:ciphertext" string back to plaintext.
 */
export function decryptField(encrypted: string): string {
  if (!encrypted || !encrypted.includes(':')) return encrypted;
  const [ivHex, ciphertext] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
