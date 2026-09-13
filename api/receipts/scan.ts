import { extractFromImage } from '../_extract';

export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: { image?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.image) {
    return Response.json({ error: "Missing 'image' (a base64 data URL)." }, { status: 400 });
  }

  try {
    const extracted = await extractFromImage(body.image);
    return Response.json(extracted);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Extraction failed.' }, { status: 502 });
  }
}
