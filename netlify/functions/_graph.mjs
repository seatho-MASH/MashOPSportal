// Microsoft Graph (app-only) helper for the Ops backend.
// Uses client-credentials: reads the SharePoint Events list (venue) and sends mail.
const TENANT        = process.env.TENANT_ID;
const CLIENT_ID     = process.env.OPS_GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.OPS_GRAPH_CLIENT_SECRET;
const SITE_HOST     = process.env.SP_SITE_HOST   || 'mashmediauk.sharepoint.com';
const SITE_PATH     = process.env.SP_SITE_PATH   || '/sites/MashTeamPortal';
const EVENTS_LIST   = process.env.SP_EVENTS_LIST || 'Events';

let _tok = null, _exp = 0;
export async function graphToken() {
  if (_tok && Date.now() < _exp - 60000) return _tok;
  if (!TENANT || !CLIENT_ID || !CLIENT_SECRET) throw new Error('Graph credentials not set (TENANT_ID / OPS_GRAPH_CLIENT_ID / OPS_GRAPH_CLIENT_SECRET).');
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', body });
  if (!r.ok) throw new Error('token ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  _tok = j.access_token; _exp = Date.now() + j.expires_in * 1000;
  return _tok;
}

async function gget(path, tok) {
  const r = await fetch('https://graph.microsoft.com/v1.0' + path, { headers: { authorization: 'Bearer ' + tok } });
  if (!r.ok) throw new Error('graph GET ' + path + ' ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}

let _siteId = null, _listId = null, _colmap = null;
async function ensureList(tok) {
  if (!_siteId) { const s = await gget(`/sites/${SITE_HOST}:${SITE_PATH}`, tok); _siteId = s.id; }
  if (!_listId) {
    const lists = await gget(`/sites/${_siteId}/lists?$select=id,name,displayName&$top=200`, tok);
    const L = (lists.value || []).find(x => x.displayName === EVENTS_LIST || x.name === EVENTS_LIST);
    if (!L) throw new Error('Events list "' + EVENTS_LIST + '" not found');
    _listId = L.id;
  }
  if (!_colmap) {
    _colmap = {};
    const cols = await gget(`/sites/${_siteId}/lists/${_listId}/columns?$select=name,displayName&$top=200`, tok);
    for (const c of cols.value || []) _colmap[c.displayName] = c.name;
  }
}
const col = (f, display) => {
  const k = _colmap && _colmap[display];
  return (k && f[k] != null ? f[k] : (f[display] != null ? f[display] : ''));
};

// Look up an event in SharePoint by its canonical id; returns venue + best-effort name/dates.
export async function eventFromSharePoint(eventId, tok) {
  await ensureList(tok);
  const items = await gget(`/sites/${_siteId}/lists/${_listId}/items?$expand=fields&$top=500`, tok);
  const idKey = _colmap['EventID'];
  const it = (items.value || []).find(x => {
    const f = x.fields || {};
    return (idKey && f[idKey] === eventId) || f.EventID === eventId || Object.values(f).includes(eventId);
  });
  if (!it) return null;
  const f = it.fields || {};
  return {
    location:  col(f, 'Location'),
    fullName:  col(f, 'Title') || col(f, 'ShortName'),
    startDate: col(f, 'StartDate'),
    endDate:   col(f, 'EndDate'),
  };
}

export async function sendMail(tok, sender, message) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!r.ok) throw new Error('sendMail ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return true;
}
