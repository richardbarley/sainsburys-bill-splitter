// netlify/functions/data.js
// Handles all data operations for the bill splitter.
//
// Required Netlify environment variables:
//   SUPABASE_URL        — your project URL from Supabase dashboard
//   SUPABASE_SERVICE_KEY — service role key (Settings > API)
//   APP_SECRET_KEY      — any random string you choose; enter this in the app settings

const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Key',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

const ok = (body) => ({ statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) });
const err = (status, msg) => ({ statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: msg }) });

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Auth — check the X-App-Key header against the env variable
  const appKey = event.headers['x-app-key'];
  if (!process.env.APP_SECRET_KEY || appKey !== process.env.APP_SECRET_KEY) {
    return err(401, 'Invalid or missing app key');
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // ── GET /api/data ─────────────────────────────────────────
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
      id: row.id,
      savedAt: new Date(row.saved_at).getTime(),
      items: row.items,
      assignments: row.assignments,
      totals: row.totals,
      totalBill: Number(row.total_bill),
      receiptDate: row.receipt_date || '',
      config: row.config_snapshot,
    }));

    return ok({ config, history });
  }

  // ── PUT /api/data ─────────────────────────────────────────
  // Body: { config?: {...}, history?: [...] }
  // Upserts config and any provided history entries.
  if (event.httpMethod === 'PUT') {
    const body = JSON.parse(event.body || '{}');

    if (body.config) {
      const { error } = await supabase.from('config').upsert({
        id: 1,
        people: body.config.people || [],
        groups: body.config.groups || [],
        updated_at: new Date().toISOString(),
      });
      if (error) return err(500, error.message);
    }

    if (Array.isArray(body.history) && body.history.length > 0) {
      const rows = body.history.map((e) => ({
        id: e.id,
        items: e.items,
        assignments: e.assignments,
        totals: e.totals,
        total_bill: e.totalBill,
        receipt_date: e.receiptDate || null,
        config_snapshot: e.config || null,
        saved_at: new Date(e.savedAt).toISOString(),
      }));
      const { error } = await supabase.from('bill_history').upsert(rows);
      if (error) return err(500, error.message);
    }

    return ok({ ok: true });
  }

  // ── DELETE /api/data ──────────────────────────────────────
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
