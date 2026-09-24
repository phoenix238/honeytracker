import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '../server/router.js';
import { toRequest, send } from '../server/node.js';

// The single Vercel Function behind every /api/* path (a catch-all route), so the whole
// API is one function. A classic Node handler, because Node's req.url carries the path the
// browser asked for.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await send(res, await handle(await toRequest(req)));
}
