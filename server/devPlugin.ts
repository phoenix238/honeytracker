import type { Plugin } from 'vite';
import { toRequest, send } from './node';

// Serves /api from the same process as Vite in development, so `npm run dev` is the whole
// app — frontend, API and a local Postgres (PGlite in .data/) — with nothing to install.

export function apiDevServer(): Plugin {
  return {
    name: 'honey-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api')) return next();
        try {
          const { handle } = (await server.ssrLoadModule('/server/router.ts')) as typeof import('./router.js');
          await send(res, await handle(await toRequest(req, 'http')));
        } catch (e) {
          next(e);
        }
      });
    },
  };
}
