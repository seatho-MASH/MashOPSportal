// Every API call is checked here, on the server. The page's sign-in only
// decides what is shown; this decides what is allowed.
//
// Mash staff: a Microsoft (Entra) ID token, sent as `Authorization: Bearer …`,
// verified against Microsoft's signing keys for our tenant and app.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './http.mjs';

const TENANT = process.env.TENANT_ID || process.env.ENTRA_TENANT_ID || '6c9f1314-32aa-4dbe-9e2d-02dedc91d895';
const CLIENT = process.env.ENTRA_CLIENT_ID || '1d72640d-2dbf-4d11-b673-aab452687f2e';
const DOMAIN = (process.env.ALLOWED_DOMAIN || 'mashmedia.net').toLowerCase();
const JWKS = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`));

const admins = () => new Set(String(process.env.OPS_ADMINS || '').toLowerCase().split(/[,;\s]+/).filter(Boolean));

export function userFromClaims(p) {
  const email = String(p.preferred_username || p.email || p.upn || '').toLowerCase();
  if (!email.endsWith('@' + DOMAIN)) throw new HttpError(403, `Sign in with your @${DOMAIN} account.`);
  return { email, name: p.name || email, oid: p.oid || null, admin: admins().has(email) };
}

export async function requireUser(req) {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw new HttpError(401, 'Not signed in.');
  let payload;
  try {
    ({ payload } = await jwtVerify(m[1], JWKS, { issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`, audience: CLIENT }));
  } catch { throw new HttpError(401, 'Your sign-in has expired — refresh the page.'); }
  return userFromClaims(payload);
}

export function requireAdmin(user) {
  if (!user.admin) throw new HttpError(403, 'Only Ops admins can do that (OPS_ADMINS on the Netlify site).');
}
