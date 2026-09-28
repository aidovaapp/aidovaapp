const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Run daily by Vercel Cron (see vercel.json). Free Supabase projects pause
// after a week with no activity; while paused, licence keys cannot be created
// or checked. One tiny read a day keeps the project awake.
module.exports = async (req, res) => {
  const { error } = await supabase.from('licences').select('id', { head: true, count: 'exact' });
  if (error) {
    console.error('Keep-alive failed:', error.message);
    return res.status(500).json({ ok: false });
  }
  return res.status(200).json({ ok: true, at: new Date().toISOString() });
};
