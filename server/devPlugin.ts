import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Serves /api from the same process as Vite in development, so `npm run dev` is the whole
// app — frontend, API and a local Postgres (PGlite in .data/) — with nothing to install.

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v != null) headers.set(k, v);
  }
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks);
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, { method, headers, body });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'set-cookie') res.setHeader(k, v);
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function apiDevServer(): Plugin {
  return {
    name: 'honey-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api')) return next();
        try {
          const { handle } = (await server.ssrLoadModule('/server/router.ts')) as typeof import('./router.js');
          await send(res, await handle(await toRequest(req)));
        } catch (e) {
          next(e);
        }
      });
    },
  };
}
