import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encrypt(plaintext: string, key: string): string {
  const keyBuf = Buffer.from(key, 'utf8');
  return encryptWithKey(plaintext, keyBuf);
}

export function decrypt(ciphertext: string, key: string): string {
  const keyBuf = Buffer.from(key, 'utf8');
  return decryptWithKey(ciphertext, keyBuf);
}

export function encryptWithKey(plaintext: string, keyBuf: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptWithKey(ciphertext: string, keyBuf: Buffer): string {
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuf, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// Derives a unique 32-byte AES key per account using HKDF.
// Compromising one account's data does not expose other accounts' tokens.
export function deriveAccountKey(masterKey: string, accountId: string): Buffer {
  const masterBuf = Buffer.from(masterKey, 'utf8');
  const salt = Buffer.from(accountId, 'utf8');
  const info = Buffer.from('token-encryption', 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', masterBuf, salt, info, 32));
}
