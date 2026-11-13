import fs from 'node:fs';

if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  throw new Error(
    'Configure CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID securely before deployment. See docs/deployment.md.',
  );
}
const target = process.argv[2];
const file = target === 'backend' ? 'backend/wrangler.jsonc' : 'wrangler.jsonc';
const config = fs.readFileSync(file, 'utf8');
if (config.includes('00000000-0000-0000-0000-000000000000') || config.includes('YOUR-SUBDOMAIN')) {
  throw new Error(`Finish the one-time configuration in ${file}. See docs/deployment.md.`);
}
console.log(`${target} deployment configuration is ready.`);
