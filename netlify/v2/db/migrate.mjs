// Applies db/schema.sql to DATABASE_URL. Idempotent — safe to run any time.
//   DATABASE_URL=postgres://… npm run migrate
import { readFileSync } from 'node:fs';
import { Pool, neonConfig } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  // First deploy before the env var is set: don't fail the build, just say so.
  console.warn('DATABASE_URL is not set — schema not applied. Add it in Netlify → Site configuration → Environment variables.');
  process.exit(0);
}
if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;
const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(sql);
  const { rows } = await pool.query("select count(*)::int n from information_schema.tables where table_schema='public'");
  console.log(`Schema applied — ${rows[0].n} tables.`);
} finally { await pool.end(); }
