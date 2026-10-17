// Grip passwords at rest: AES-256-GCM, key from OPS_SECRET_KEY (32 random bytes, base64).
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
function key() {
  const k = process.env.OPS_SECRET_KEY;
  if (!k) throw new Error('OPS_SECRET_KEY is not set — logins cannot be stored until it is.');
  const b = Buffer.from(k, 'base64');
  if (b.length !== 32) throw new Error('OPS_SECRET_KEY must be 32 bytes, base64-encoded.');
  return b;
}
export function seal(plain) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
export function open(sealed) {
  if (!sealed) return '';
  const [v, iv, tag, enc] = sealed.split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}
export const sha = (s) => createHash('sha256').update(s).digest('hex');
