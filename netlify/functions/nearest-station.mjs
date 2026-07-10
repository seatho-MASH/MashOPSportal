import { graphToken, eventFromSharePoint } from './_graph.mjs';
import { STATIONS } from './stations.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

// Geocode a UK venue string to coords using postcodes.io only (reliable server-side).
// 1) full postcode; 2) fall back to the outward code (e.g. "TN22") if the full one misses.
async function geocode(loc) {
  const pc = (loc.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i) || [])[0];
  if (pc) {
    try {
      const j = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc.replace(/\s+/g, '')))
        .then(r => r.json());
      if (j && j.result && j.result.latitude != null) return { lat: j.result.latitude, lon: j.result.longitude, via: 'postcode' };
    } catch (e) {}
  }
  const out = (loc.match(/\b[A-Z]{1,2}\d[A-Z\d]?\b/i) || [])[0];
  if (out) {
    try {
      const j = await fetch('https://api.postcodes.io/outcodes/' + encodeURIComponent(out.replace(/\s+/g, '')))
        .then(r => r.json());
      if (j && j.result && j.result.latitude != null) return { lat: j.result.latitude, lon: j.result.longitude, via: 'outcode' };
    } catch (e) {}
  }
  return null;
}

function dist(la1, lo1, la2, lo2) {
  const R = 6371, dl = (la2 - la1) * Math.PI / 180, dn = (lo2 - lo1) * Math.PI / 180;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dn / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Nearest station from the bundled UK stations list (no external map API).
function nearest(lat, lon) {
  let best = null, bd = 1e9;
  for (const s of STATIONS) {
    const d = dist(lat, lon, s[1], s[2]);
    if (d < bd) { bd = d; best = s[0]; }
  }
  return best ? { station: best, dist: +bd.toFixed(2) } : null;
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

  const n = nearest(g.lat, g.lon);
  if (!n) return json({ venue, station: null });
  return json({ venue, station: n.station, dist: n.dist });
};

export const config = { path: '/api/nearest-station' };
