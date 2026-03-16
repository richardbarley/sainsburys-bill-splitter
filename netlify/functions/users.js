// netlify/functions/users.js
// User management — list, invite, and remove users.
// All operations require a valid Supabase JWT.
// Invite and remove additionally require the caller to be the admin (ADMIN_EMAIL env var).
//
// Required Netlify environment variables:
//   SUPABASE_URL         — your project URL
//   SUPABASE_SERVICE_KEY — service role key (keeps admin power server-side)
//   ADMIN_EMAIL          — email address of the app admin (e.g. richardbarley@gmail.com)

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

const ok = (body) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(body) });
const fail = (status, msg) => ({ statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) });

const getCallerUser = async (supabase, event) => {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const caller = await getCallerUser(supabase, event);
  if (!caller) return fail(401, 'Unauthorized');

  const isAdmin = caller.email === process.env.ADMIN_EMAIL;

  // ── GET /api/users ─ list all authenticated users ────────────
  if (event.httpMethod === 'GET') {
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) return fail(500, error.message);
    const safe = users.map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in_at,
      confirmed: !!u.confirmed_at,
    }));
    return ok({ users: safe });
  }

  // ── POST /api/users ─ invite a user by email (admin only) ────
  if (event.httpMethod === 'POST') {
    if (!isAdmin) return fail(403, 'Forbidden');
    const body = JSON.parse(event.body || '{}');
    if (!body.email) return fail(400, 'email is required');
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(body.email, {
      redirectTo: process.env.SITE_URL || undefined,
    });
    if (error) return fail(400, error.message);
    return ok({ success: true, userId: data.user?.id });
  }

  // ── DELETE /api/users ─ remove a user (admin only) ───────────
  if (event.httpMethod === 'DELETE') {
    if (!isAdmin) return fail(403, 'Forbidden');
    const body = JSON.parse(event.body || '{}');
    if (!body.userId) return fail(400, 'userId is required');
    if (body.userId === caller.id) return fail(400, 'You cannot remove yourself');
    const { error } = await supabase.auth.admin.deleteUser(body.userId);
    if (error) return fail(400, error.message);
    return ok({ success: true });
  }

  return fail(405, 'Method not allowed');
};
