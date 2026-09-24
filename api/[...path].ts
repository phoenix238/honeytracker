import { handle } from '../server/router.js';

// The single Vercel Function behind every /api/* path (a catch-all route), so the whole
// API is one function — well inside the Hobby plan's function limit.
export default {
  fetch(request: Request): Promise<Response> {
    return handle(request);
  },
};
