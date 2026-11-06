import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string | Buffer, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

// ── Passwords (scrypt, N=2^15) ─────────────────────────────────────────────
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const hmacSha256 = (secret: string | Buffer, data: string | Buffer): string =>
  createHmac('sha256', secret).update(data).digest('hex');

// ── Symmetric encryption (AES-256-GCM) ─────────────────────────────────────
/** Encrypts small strings (secrets at rest). Output: base64(iv | tag | ciphertext). */
export function encryptString(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}
export function decryptString(key: Buffer, payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

const BACKUP_MAGIC = Buffer.from('OMEGABK1');
/** Encrypts a whole backup file. Layout: MAGIC(8) | salt(16) | iv(12) | tag(16) | ciphertext. Key derived via scrypt. */
export async function encryptBuffer(passphrase: string, data: Buffer): Promise<Buffer> {
  const salt = randomBytes(16);
  const key = await scrypt(passphrase, salt, 32, SCRYPT);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([BACKUP_MAGIC, salt, iv, cipher.getAuthTag(), enc]);
}
export async function decryptBuffer(passphrase: string, data: Buffer): Promise<Buffer> {
  if (!data.subarray(0, 8).equals(BACKUP_MAGIC)) throw new Error('Keine verschlüsselte OMEGA-Sicherung (Kennung fehlt).');
  const salt = data.subarray(8, 24);
  const iv = data.subarray(24, 36);
  const tag = data.subarray(36, 52);
  const key = await scrypt(passphrase, salt, 32, SCRYPT);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(52)), decipher.final()]);
}
export const isEncryptedBackup = (head: Buffer): boolean => head.subarray(0, 8).equals(BACKUP_MAGIC);
