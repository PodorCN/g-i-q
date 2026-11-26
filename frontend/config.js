// Where the frontend reads data from. This is the ONLY place the backend URL lives.
// After `wrangler deploy`, set apiBase to your Worker URL (no trailing slash), e.g.
//   "https://giq-api.<your-subdomain>.workers.dev"
// Leave "" to call /api/* on the same origin (e.g. if you route the Worker under the Pages domain).
// For local testing you can also append ?api=http://localhost:8787 to the page URL.
window.GIQ_CONFIG = {
  apiBase: "",
};
