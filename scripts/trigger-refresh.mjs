const { GIQ_API_URL, GIQ_ADMIN_TOKEN } = process.env;
if (!GIQ_API_URL || !GIQ_ADMIN_TOKEN)
  throw new Error('Set GIQ_API_URL and GIQ_ADMIN_TOKEN securely in your environment.');
const response = await fetch(new URL('/api/refresh', GIQ_API_URL), {
  method: 'POST',
  headers: { Authorization: `Bearer ${GIQ_ADMIN_TOKEN}` },
  signal: AbortSignal.timeout(600_000),
});
const payload = await response.json();
if (!response.ok || payload.status === 'failed')
  throw new Error(
    `Refresh failed: HTTP ${response.status}; ${payload.error || payload.message || 'inspect /api/health'}`,
  );
console.log(JSON.stringify(payload, null, 2));
