// netlify/functions/data.js
// Handles all bill data operations for the bill splitter.
// Authentication: Supabase JWT passed as  Authorization: Bearer <token>
//
// Required Netlify environment variables:
//   SUPABASE_URL         — your project URL from Supabase dashboard
//   SUPABASE_SERVICE_KEY — service role key (Settings > API)

const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

const ok  = (body)       => ({ statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) });
const err = (status, msg) => ({ statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: msg }) });

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Auth — validate the Supabase JWT
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return err(401, 'Missing Authorization header');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return err(401, 'Invalid or expired token');

  // ── GET /api/data ─────────────────────────────────────────────
  // Returns { config: {...}, history: [...] }
  if (event.httpMethod === 'GET') {
    const [{ data: configRow }, { data: historyRows }] = await Promise.all([
      supabase.from('config').select('*').eq('id', 1).single(),
      supabase.from('bill_history').select('*').order('saved_at', { ascending: false }).limit(30),
    ]);

    const config = configRow
      ? { people: configRow.people || [], groups: configRow.groups || [] }
      : null;

    const history = (historyRows || []).map((row) => ({
      id:          row.id,
      savedAt:     new Date(row.saved_at).getTime(),
      updatedAt:      row.updated_at ? new Date(row.updated_at).getTime() : null,
      items:          row.items,
      assignments:    row.assignments,
      totals:         row.totals,
      totalBill:      Number(row.total_bill),
      receiptDate:    row.receipt_date || '',
      config:         row.config_snapshot,
      assignedTo:     row.assigned_to || null,
      assignedBy:     row.assigned_by || null,
      assignedStatus: row.assigned_status || null,
      completedBy:    row.completed_by || null,
      completedAt:    row.completed_at ? new Date(row.completed_at).getTime() : null,
    }));

    return ok({ config, history });
  }

  // ── PUT /api/data ─────────────────────────────────────────────
  // Body: { config?: {...}, history?: [...] }
  // Upserts config and/or history entries.
  if (event.httpMethod === 'PUT') {
    const body = JSON.parse(event.body || '{}');

    if (body.config) {
      const { error } = await supabase.from('config').upsert({
        id:         1,
        people:     body.config.people || [],
        groups:     body.config.groups || [],
        updated_at: new Date().toISOString(),
      });
      if (error) return err(500, error.message);
    }

    if (Array.isArray(body.history) && body.history.length > 0) {
      const rows = body.history.map((e) => ({
        id:              e.id,
        items:           e.items,
        assignments:     e.assignments,
        totals:          e.totals,
        total_bill:      e.totalBill,
        receipt_date:    e.receiptDate || null,
        config_snapshot: e.config || null,
        saved_at:        new Date(e.savedAt).toISOString(),
        updated_at:      e.updatedAt ? new Date(e.updatedAt).toISOString() : null,
        assigned_to:     e.assignedTo || null,
        assigned_by:     e.assignedBy || null,
        assigned_status: e.assignedStatus || null,
        completed_by:    e.completedBy || null,
        completed_at:    e.completedAt ? new Date(e.completedAt).toISOString() : null,
      }));
      const { error } = await supabase.from('bill_history').upsert(rows);
      if (error) return err(500, error.message);
    }

    return ok({ ok: true });
  }

  // ── DELETE /api/data ──────────────────────────────────────────
  // Body: { historyId: number }
  if (event.httpMethod === 'DELETE') {
    const body = JSON.parse(event.body || '{}');
    if (body.historyId) {
      const { error } = await supabase
        .from('bill_history')
        .delete()
        .eq('id', body.historyId);
      if (error) return err(500, error.message);
    }
    return ok({ ok: true });
  }

  return err(405, 'Method not allowed');
};
