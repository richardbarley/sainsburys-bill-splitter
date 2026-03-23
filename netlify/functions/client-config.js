// netlify/functions/client-config.js
// Returns the public Supabase config needed to initialise the browser client.
// This endpoint is intentionally unauthenticated — the anon key is safe to expose.
//
// Required Netlify environment variables:
//   SUPABASE_URL       — your project URL from Supabase dashboard
//   SUPABASE_ANON_KEY  — public anon key (Settings > API > Project API keys)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Server misconfigured — SUPABASE_URL or SUPABASE_ANON_KEY not set' }) };
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ supabaseUrl, supabaseAnonKey }),
  };
};
