const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const MAX_ATTEMPTS_PER_HOUR = 5;
const PREMIUM_DEVICE_LIMIT = 3;
const PREMPLUS_DEVICE_LIMIT = 5;

async function checkRateLimit(ip) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('key_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip_address', ip)
    .eq('success', false)
    .gte('attempted_at', oneHourAgo);
  return count >= MAX_ATTEMPTS_PER_HOUR;
}

async function logAttempt(ip, success) {
  await supabase.from('key_attempts').insert({
    ip_address: ip,
    success: success,
    attempted_at: new Date().toISOString()
  });
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('key_attempts').delete().lt('attempted_at', oneDayAgo);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';

  try {
    const { licence_key, device_id, device_name } = req.body;

    if (!licence_key || !device_id) {
      return res.status(400).json({ valid: false, error: 'Missing licence key or device ID' });
    }

    // Rate limiting
    const rateLimited = await checkRateLimit(ip);
    if (rateLimited) {
      return res.status(429).json({ 
        valid: false, 
        error: 'Too many attempts. Please try again in an hour or contact hello@aidova.app' 
      });
    }

    // Look up licence
    const { data: licence, error: licenceError } = await supabase
      .from('licences')
      .select('licence_key, plan, status, email, device_limit, refunded_at')
      .eq('licence_key', licence_key.toUpperCase().trim())
      .single();

    if (licenceError || !licence) {
      await logAttempt(ip, false);
      return res.status(200).json({ valid: false, error: 'Invalid licence key' });
    }

    if (licence.refunded_at) {
      await logAttempt(ip, false);
      return res.status(200).json({ valid: false, error: 'This licence has been refunded. Please subscribe again at aidova.app' });
    }

    if (licence.status !== 'active') {
      await logAttempt(ip, false);
      return res.status(200).json({ valid: false, error: 'Your subscription is no longer active. Please renew at aidova.app to continue using Premium.' });
    }

    const deviceLimit = licence.device_limit || (licence.plan === 'premplus' ? PREMPLUS_DEVICE_LIMIT : PREMIUM_DEVICE_LIMIT);

    // Check if device already registered
    const { data: existingDevice } = await supabase
      .from('licence_devices')
      .select('id, is_active')
      .eq('licence_key', licence_key.toUpperCase().trim())
      .eq('device_id', device_id)
      .single();

    if (existingDevice) {
      await supabase.from('licence_devices')
        .update({ last_seen: new Date().toISOString(), is_active: true })
        .eq('licence_key', licence_key.toUpperCase().trim())
        .eq('device_id', device_id);
      await supabase.from('licences')
        .update({ last_verified: new Date().toISOString() })
        .eq('licence_key', licence_key.toUpperCase().trim());
      await logAttempt(ip, true);
      return res.status(200).json({ valid: true, plan: licence.plan, email: licence.email, device_registered: true });
    }

    // New device - check limit
    const { count: activeDeviceCount } = await supabase
      .from('licence_devices')
      .select('*', { count: 'exact', head: true })
      .eq('licence_key', licence_key.toUpperCase().trim())
      .eq('is_active', true);

    if (activeDeviceCount >= deviceLimit) {
      await logAttempt(ip, false);
      return res.status(200).json({ 
        valid: false, 
        error: `This key is already active on ${deviceLimit} device${deviceLimit > 1 ? 's' : ''} (the maximum for your plan). To add this device, please remove one first.`,
        device_limit_reached: true,
        licence_key: licence_key.toUpperCase().trim(),
        email: licence.email
      });
    }

    // Register new device
    await supabase.from('licence_devices').insert({
      licence_key: licence_key.toUpperCase().trim(),
      device_id: device_id,
      device_name: device_name || 'Unknown device',
      activated_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      is_active: true
    });

    await supabase.from('licences')
      .update({ last_verified: new Date().toISOString() })
      .eq('licence_key', licence_key.toUpperCase().trim());

    await logAttempt(ip, true);
    return res.status(200).json({ 
      valid: true, plan: licence.plan, email: licence.email,
      device_registered: true, devices_used: activeDeviceCount + 1, device_limit: deviceLimit
    });

  } catch (err) {
    console.error('Verify licence error:', err);
    return res.status(500).json({ error: err.message });
  }
};
