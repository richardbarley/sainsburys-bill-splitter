// netlify/functions/plans-config.js
// Returns the public Supabase config the Payment Plans app needs to
// initialise its browser client.
//
// This is a DIFFERENT Supabase project from the Sainsbury's bill splitter:
// that one lives in a free org and pauses after a period of inactivity,
// so Payment Plans points at the Pro-org "Home" project instead.
// Sainsbury's keeps using client-config.js and SUPABASE_* untouched.
//
// The publishable key is safe to expose — every pp_ table has RLS on and
// gates on pp_is_member()/pp_is_owner(), which read the caller's verified
// JWT email. Without a signed-in member the key grants nothing.
//
// Also hands out the VAPID public key for web push. That key is public by
// definition — it is what the browser encrypts a subscription to, and it is
// useless without the private half, which never leaves the server.
//
// Required Netlify environment variables:
//   PLANS_SUPABASE_URL       — Home project URL
//   PLANS_SUPABASE_ANON_KEY  — Home project publishable (anon) key
//   PLANS_VAPID_PUBLIC       — VAPID public key (optional; push is simply
//                              unavailable in the UI when it is absent)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl     = process.env.PLANS_SUPABASE_URL;
  const supabaseAnonKey = process.env.PLANS_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Server misconfigured — PLANS_SUPABASE_URL or PLANS_SUPABASE_ANON_KEY not set' }),
    };
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      supabaseUrl,
      supabaseAnonKey,
      vapidPublicKey: process.env.PLANS_VAPID_PUBLIC || null,
    }),
  };
};
