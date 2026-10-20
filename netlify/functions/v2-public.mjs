import { publicHandle } from '../v2/lib/public.mjs';
export default (req) => publicHandle(req);
export const config = { path: '/api/v2-public/*' };
