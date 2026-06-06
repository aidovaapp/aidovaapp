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
    const { action, licence_key, device_id } = req.body;

    if (!licence_key) {
      return res.status(400).json({ error: 'Missing licence key' });
    }

    const key = licence_key.toUpperCase().trim();

    // Verify licence exists and is active
    const { data: licence, error: licenceError } = await supabase
      .from('licences')
      .select('licence_key, plan, status, email, device_limit')
      .eq('licence_key', key)
      .single();

    if (licenceError || !licence) {
      return res.status(200).json({ error: 'Invalid licence key' });
    }

    if (licence.status !== 'active') {
      return res.status(200).json({ error: 'Subscription is not active' });
    }

    // LIST devices
    if (action === 'list') {
      const { data: devices } = await supabase
        .from('licence_devices')
        .select('device_id, device_name, activated_at, last_seen, is_active')
        .eq('licence_key', key)
        .eq('is_active', true)
        .order('last_seen', { ascending: false });

      const deviceLimit = licence.device_limit || (licence.plan === 'premplus' ? 10 : 3);

      return res.status(200).json({ 
        devices: devices || [],
        device_limit: deviceLimit,
        plan: licence.plan,
        email: licence.email
      });
    }

    // REMOVE device
    if (action === 'remove') {
      if (!device_id) {
        return res.status(400).json({ error: 'Missing device ID' });
      }

      await supabase
        .from('licence_devices')
        .update({ is_active: false })
        .eq('licence_key', key)
        .eq('device_id', device_id);

      return res.status(200).json({ success: true, message: 'Device removed successfully' });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (err) {
    console.error('Manage devices error:', err);
    return res.status(500).json({ error: err.message });
  }
};
