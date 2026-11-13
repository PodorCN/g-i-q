export type Fetcher = typeof fetch;
export async function readPublic(
  url: string,
  fetcher: Fetcher = fetch,
  request: Pick<RequestInit, 'method' | 'body' | 'headers'> = {},
): Promise<string> {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('Only HTTPS sources are supported');
  const allowed = [
    'api.bls.gov',
    'www.bls.gov',
    'www.blackrock.com',
    'www.schwab.com',
    'international.schwab.com',
    'am.jpmorgan.com',
    'www.pimco.com',
    'www.goldmansachs.com',
    'www.morganstanley.com',
    'corporate.vanguard.com',
    'think.ing.com',
    'www.federalreserve.gov',
    'www.bea.gov',
    'bea.gov',
    'www.atlantafed.org',
  ];
  if (!allowed.includes(target.hostname))
    throw new Error(`Source host is not allowlisted: ${target.hostname}`);
  const response = await fetcher(url, {
    ...request,
    headers: {
      'User-Agent': 'GIQ-Research/1.0 (+https://github.com/PodorCN/g-i-q)',
      Accept: 'application/json, application/xml, text/html, */*',
      ...request.headers,
    },
    signal: AbortSignal.timeout(22_000),
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('Location');
    if (!location) throw new Error(`HTTP ${response.status} without a redirect destination`);
    const redirected = new URL(location, url);
    if (redirected.hostname !== target.hostname)
      throw new Error(
        'Cross-host source redirect blocked; update the catalog with its canonical URL',
      );
    // One redirect only, bounded; no arbitrary redirect chains.
    const next = await fetcher(redirected, {
      signal: AbortSignal.timeout(22_000),
      redirect: 'manual',
    });
    if (!next.ok) throw new Error(`HTTP ${next.status}`);
    return readBounded(next);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readBounded(response);
}
async function readBounded(response: Response): Promise<string> {
  const length = Number(response.headers.get('Content-Length') || 0);
  if (length > 3_000_000) throw new Error('Source exceeds the 3 MB collection limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 3_000_000) {
      await reader.cancel();
      throw new Error('Source exceeds the 3 MB collection limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
