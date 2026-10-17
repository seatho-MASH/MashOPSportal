// One HTTP connection helper for every function. Neon's HTTP driver suits
// serverless: no pool to exhaust, each query is one round trip.
import { neon } from '@neondatabase/serverless';

let _sql = null;
export function db() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set on this site.');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}
// q('select … where id = $1', [id]) → rows
export const q = (text, params = []) => db()(text, params);
export const one = async (text, params = []) => (await q(text, params))[0] || null;
// Several statements, all-or-nothing: tx([[text, params], …])
export const tx = (list) => db().transaction(list.map(([t, p]) => db()(t, p || [])));
