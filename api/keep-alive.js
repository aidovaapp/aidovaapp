const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Called daily by Vercel Cron (see vercel.json) and every 6 hours by a GitHub
// Actions schedule (.github/workflows/keep-alive.yml). Free Supabase projects
// pause after a week of low activity; while paused, licence keys cannot be
// created or checked. Each call does a few tiny reads across our real tables
// so the project counts as genuinely in use.
module.exports = async (req, res) => {
  const tables = ['licences', 'licence_devices', 'key_attempts'];
  const results = await Promise.all(
    tables.map((t) => supabase.from(t).select('*', { head: true, count: 'exact' }))
  );
  // The licences table is the one that must work; the others are best-effort.
  if (results[0].error) {
    console.error('Keep-alive failed:', results[0].error.message);
    return res.status(500).json({ ok: false });
  }
  return res.status(200).json({ ok: true, tables: results.map((r) => !r.error), at: new Date().toISOString() });
};
