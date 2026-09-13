import { extractFromText } from './_extract';

export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.text) {
    return Response.json({ error: "Missing 'text'." }, { status: 400 });
  }

  try {
    const extracted = await extractFromText(body.text);
    return Response.json(extracted);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Extraction failed.' }, { status: 502 });
  }
}
