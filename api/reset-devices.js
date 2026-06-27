const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Simple email sender via SendGrid
async function sendResetEmail(email, resetToken, licenceKey) {
  const resetUrl = `https://aidova.app/api/confirm-reset?token=${resetToken}&key=${licenceKey}`;
  
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: { email: 'hello@aidova.app', name: 'Aidova' },
      subject: 'Reset your Aidova device activations',
      content: [{
        type: 'text/html',
        value: `
          <p>Hi,</p>
          <p>We received a request to reset all device activations for your Aidova licence key: <strong>${licenceKey}</strong></p>
          <p>Click the button below to confirm. This will remove all devices from your licence so you can activate on a new device.</p>
          <p><a href="${resetUrl}" style="background:#2D6A4F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">Reset my devices</a></p>
          <p>This link expires in 1 hour.</p>
          <p>If you did not request this, please ignore this email — your licence is safe.</p>
          <p>Need help? Email hello@aidova.app</p>
          <p>— The Aidova team</p>
        `
      }]
    })
  });
  
  return response.ok;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // POST — request reset email
    if (req.method === 'POST') {
      const { licence_key } = req.body;
      if (!licence_key) return res.status(400).json({ error: 'Missing licence key' });

      const key = licence_key.toUpperCase().trim();

      // Look up licence
      const { data: licence, error } = await supabase
        .from('licences')
        .select('licence_key, plan, status, email')
        .eq('licence_key', key)
        .single();

      if (error || !licence) {
        return res.status(200).json({ error: 'Invalid licence key' });
      }

      if (licence.status !== 'active') {
        return res.status(200).json({ error: 'Subscription is not active' });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

      // Store reset token in Supabase
      await supabase.from('device_reset_tokens').upsert({
        licence_key: key,
        token: resetToken,
        expires_at: expiresAt,
        used: false
      });

      // Send email
      const sent = await sendResetEmail(licence.email, resetToken, key);

      if (!sent) {
        return res.status(500).json({ error: 'Could not send email. Please contact hello@aidova.app' });
      }

      return res.status(200).json({ 
        success: true, 
        message: `Reset email sent to ${licence.email.replace(/(.{2}).*(@.*)/, '$1***$2')}` 
      });
    }

    // GET — confirm reset via link
    if (req.method === 'GET') {
      const { token, key } = req.query;
      if (!token || !key) return res.status(400).send('Invalid reset link');

      // Look up token
      const { data: resetData, error } = await supabase
        .from('device_reset_tokens')
        .select('*')
        .eq('licence_key', key.toUpperCase())
        .eq('token', token)
        .eq('used', false)
        .single();

      if (error || !resetData) {
        return res.status(200).send(`
          <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h2>❌ Invalid or expired reset link</h2>
          <p>This link has already been used or has expired. Please request a new reset from the app.</p>
          </body></html>
        `);
      }

      // Check expiry
      if (new Date(resetData.expires_at) < new Date()) {
        return res.status(200).send(`
          <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h2>❌ Reset link expired</h2>
          <p>This link expired after 1 hour. Please request a new reset from the app.</p>
          </body></html>
        `);
      }

      // Deactivate all devices for this licence
      await supabase
        .from('licence_devices')
        .update({ is_active: false })
        .eq('licence_key', key.toUpperCase());

      // Mark token as used
      await supabase
        .from('device_reset_tokens')
        .update({ used: true })
        .eq('licence_key', key.toUpperCase())
        .eq('token', token);

      return res.status(200).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px;max-width:500px;margin:0 auto">
        <h2>✅ Devices reset successfully</h2>
        <p>All devices have been removed from your licence key.</p>
        <p>You can now open Aidova on your new device and enter your licence key to activate it.</p>
        <p style="margin-top:30px"><a href="https://aidova.app" style="background:#2D6A4F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Open Aidova</a></p>
        </body></html>
      `);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Reset devices error:', err);
    return res.status(500).json({ error: err.message });
  }
};
