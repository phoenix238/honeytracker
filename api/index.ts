import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '../server/router.js';
import { toRequest, send } from '../server/node.js';

// The single Vercel Function behind every /api/* path: vercel.json rewrites them all here
// (a [...path] file only catches one path segment on Vercel). A classic Node handler, because
// Node's req.url keeps the path the browser asked for; the rewrite also passes it as ?__path=
// in case it doesn't.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await send(res, await handle(await toRequest(req)));
}
