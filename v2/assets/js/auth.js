// Microsoft sign-in (MSAL). The ID token is sent with every API call and the
// server checks it — the page hiding itself is not the security.
const CFG = { clientId: '1d72640d-2dbf-4d11-b673-aab452687f2e', tenantId: '6c9f1314-32aa-4dbe-9e2d-02dedc91d895', domain: 'mashmedia.net' };
const SCOPES = ['openid', 'profile', 'email', 'User.Read'];
let app = null, account = null;

export async function signIn(interactive) {
  if (!window.msal) throw new Error("Couldn't load Microsoft sign-in — check your connection and refresh.");
  app = app || new msal.PublicClientApplication({ auth: { clientId: CFG.clientId, authority: `https://login.microsoftonline.com/${CFG.tenantId}`, redirectUri: location.origin },
    cache: { cacheLocation: 'localStorage' } });
  if (app.initialize) await app.initialize();
  account = app.getAllAccounts()[0] || null;
  if (!account && interactive) account = (await app.loginPopup({ scopes: SCOPES, prompt: 'select_account' })).account;
  if (!account) return null;
  if (!String(account.username).toLowerCase().endsWith('@' + CFG.domain)) { await app.logoutPopup({ account }).catch(() => {}); throw new Error(`Please sign in with your @${CFG.domain} account.`); }
  return { email: account.username.toLowerCase(), name: account.name || account.username };
}
export async function idToken() {
  try { return (await app.acquireTokenSilent({ scopes: SCOPES, account })).idToken; }
  catch { return (await app.acquireTokenPopup({ scopes: SCOPES, account })).idToken; }
}
export async function signOut() { await app.logoutPopup({ account }).catch(() => {}); location.reload(); }

export async function api(path, opts = {}) {
  const tok = await idToken();
  path = path.replace(/^\/api\//, '/api/v2/');      // v2 lives beside the current portal's /api
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}), authorization: 'Bearer ' + tok },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return j;
}
