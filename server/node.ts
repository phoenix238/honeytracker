import type { IncomingMessage, ServerResponse } from 'node:http';

// Bridges Node's (req, res) to the web-standard Request/Response the router speaks. Used by
// the Vercel Function and the dev server alike: Node's req.url is the path the browser
// actually asked for, even behind Vercel's routing.

export async function toRequest(req: IncomingMessage, protocol = 'https'): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v != null) headers.set(k, v);
  }
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks);
  const proto = String(req.headers['x-forwarded-proto'] ?? protocol).split(',')[0];
  return new Request(`${proto}://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, { method, headers, body });
}

export async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'set-cookie') res.setHeader(k, v);
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
