const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { licence_key } = req.body;

    if (!licence_key) {
      return res.status(400).json({ error: 'Missing licence key' });
    }

    const { data, error } = await supabase
      .from('licences')
      .select('plan, status, email')
      .eq('licence_key', licence_key.toUpperCase().trim())
      .single();

    if (error || !data) {
      return res.status(200).json({ valid: false, error: 'Invalid licence key' });
    }

    if (data.status !== 'active') {
      return res.status(200).json({ 
        valid: false, 
        error: 'Subscription inactive. Please check your billing at hello@aidova.app' 
      });
    }

    return res.status(200).json({ 
      valid: true, 
      plan: data.plan,
      email: data.email
    });

  } catch (err) {
    console.error('Verify licence error:', err);
    return res.status(500).json({ error: err.message });
  }
};
