interface PagesContext {
  request: Request;
  env: { BACKEND_URL?: string; BACKEND?: { fetch(request: Request): Promise<Response> } };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const incoming = new URL(context.request.url);
  if (
    context.request.method !== 'GET' ||
    !/^\/api\/(snapshot|history|health)$/.test(incoming.pathname)
  ) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  if (
    !context.env.BACKEND &&
    (!context.env.BACKEND_URL || context.env.BACKEND_URL.includes('YOUR-SUBDOMAIN'))
  ) {
    return Response.json(
      { error: 'Set BACKEND_URL in the Pages project settings to connect the research API.' },
      { status: 503 },
    );
  }
  const target = new URL(
    incoming.pathname + incoming.search,
    context.env.BACKEND_URL || 'https://giq-api',
  );
  const headers = new Headers();
  const etag = context.request.headers.get('If-None-Match');
  if (etag) headers.set('If-None-Match', etag);
  try {
    const request = new Request(target, { headers, signal: AbortSignal.timeout(15_000) });
    const response = await (context.env.BACKEND
      ? context.env.BACKEND.fetch(request)
      : fetch(request));
    const outgoing = new Headers();
    for (const key of ['Content-Type', 'Cache-Control', 'ETag']) {
      const value = response.headers.get(key);
      if (value) outgoing.set(key, value);
    }
    outgoing.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json(
      { error: 'Research API is unavailable. Try again shortly.' },
      { status: 502 },
    );
  }
}
