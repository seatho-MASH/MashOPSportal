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
      if (j && j.result && j.result.latitude != null) return { lat: j.result.latitude, lon: j.result.longitude };
    } catch (e) {}
  }
  const out = (loc.match(/\b[A-Z]{1,2}\d[A-Z\d]?\b/i) || [])[0];
  if (out) {
    try {
      const j = await fetch('https://api.postcodes.io/outcodes/' + encodeURIComponent(out.replace(/\s+/g, '')))
        .then(r => r.json());
      if (j && j.result && j.result.latitude != null) return { lat: j.result.latitude, lon: j.result.longitude };
    } catch (e) {}
  }
  return null;
}

function dist(la1, lo1, la2, lo2) {
  const R = 6371, dl = (la2 - la1) * Math.PI / 180, dn = (lo2 - lo1) * Math.PI / 180;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dn / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Nearest N stations from the bundled list (no external map API), deduped by name.
function nearestOptions(lat, lon, n = 3) {
  const scored = STATIONS
    .map(s => ({ name: s[0], label: s[3], dist: +dist(lat, lon, s[1], s[2]).toFixed(2) }))
    .sort((a, b) => a.dist - b.dist);
  const out = [], seen = new Set();
  for (const s of scored) {
    const k = s.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

export default async (req) => {
  const id = new URL(req.url).searchParams.get('event');
  if (!id) return json({ error: 'Missing ?event=' }, 400);

  let tok; try { tok = await graphToken(); } catch (e) { return json({ error: String(e.message || e) }, 500); }

  let venue = '';
  try { const sp = await eventFromSharePoint(id, tok); venue = (sp && sp.location) || ''; }
  catch (e) { return json({ error: String(e.message || e) }, 502); }
  if (!venue) return json({ venue: '', station: null, options: [] });

  const g = await geocode(venue);
  if (!g) return json({ venue, station: null, options: [] });

  const options = nearestOptions(g.lat, g.lon, 3);
  const top = options[0] || null;
  return json({
    venue,
    station: top ? top.name : null,
    stationLabel: top ? top.label : null,
    dist: top ? top.dist : null,
    options,
  });
};

export const config = { path: '/api/nearest-station' };
