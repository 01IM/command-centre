// OPTIONAL "calendar helper" so your iPhone / iPad can refresh your calendars directly (any time,
// even when the laptop is off). Without it, phones show the copy relayed by the Windows app.
//
// Supabase → Edge Functions → Deploy a new function → Via Editor → name it exactly:  ics
// Paste this whole file, click Deploy. Keep "Verify JWT" ON (only you, signed in, can use it).

const ALLOWED = /^https:\/\/(calendar\.google\.com|outlook\.office365\.com|outlook\.office\.com|outlook\.live\.com)\//;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url).searchParams.get('url') ?? '';
  if (!ALLOWED.test(url)) return new Response('Only Google / Outlook calendar links are allowed', { status: 400, headers: cors });
  const res = await fetch(url, { headers: { 'User-Agent': 'CommandCentre/1.0' } });
  return new Response(await res.text(), {
    status: res.status,
    headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' },
  });
});
