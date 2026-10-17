import { requireUser } from '../v2/lib/auth.mjs';
import { handle } from '../v2/lib/router.mjs';
import { json, HttpError } from '../v2/lib/http.mjs';

export default async (req) => {
  let user;
  try { user = await requireUser(req); }
  catch (e) { return json({ error: e.message }, e instanceof HttpError ? e.status : 401); }
  return handle(req, user);
};
export const config = { path: '/api/v2/*' };
