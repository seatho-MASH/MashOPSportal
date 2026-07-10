import { graphToken, eventFromSharePoint } from './_graph.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
const UA = { 'user-agent': 'MashOpsPortal/1.0 (ops@mashmedia.net)' };

async function geocode(loc) {
  const pc = (loc.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i) || [])[0];
  const qs = [loc, loc + ', UK']; if (pc) qs.push(pc + ', UK'); qs.push(loc.split(',')[0] + ', London, UK');
  for (const q of qs) {
    const g = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: UA })
      .then(r => r.json()).catch(() => null);
    if (g && g.length) return { lat: +g[0].lat, lon: +g[0].lon };
  }
  return null;
}
function dist(la1, lo1, la2, lo2) {
  const R = 6371, dl = (la2 - la1) * Math.PI / 180, dn = (lo2 - lo1) * Math.PI / 180;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dn / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default async (req) => {
  const id = new URL(req.url).searchParams.get('event');
  if (!id) return json({ error: 'Missing ?event=' }, 400);

  let tok; try { tok = await graphToken(); } catch (e) { return json({ error: String(e.message || e) }, 500); }

  let venue = '';
  try { const sp = await eventFromSharePoint(id, tok); venue = (sp && sp.location) || ''; }
  catch (e) { return json({ error: String(e.message || e) }, 502); }
  if (!venue) return json({ venue: '', station: null });

  const g = await geocode(venue);
  if (!g) return json({ venue, station: null });

  const q = '[out:json][timeout:20];(node[railway=station](around:15000,' + g.lat + ',' + g.lon + ');node[railway=halt](around:15000,' + g.lat + ',' + g.lon + '););out;';
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q }).then(x => x.json()).catch(() => null);
  if (!r || !r.elements || !r.elements.length) return json({ venue, station: null });

  let best = null, bd = 1e9;
  for (const el of r.elements) {
    if (!el.tags || !el.tags.name) continue;
    const d = dist(g.lat, g.lon, el.lat, el.lon);
    if (d < bd) { bd = d; best = el.tags.name; }
  }
  return json({ venue, station: best, dist: best ? +bd.toFixed(2) : null });
};

export const config = { path: '/api/nearest-station' };
