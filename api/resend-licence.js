const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('./_email');

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
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    const { data, error } = await supabase
      .from('licences')
      .select('licence_key, plan, status')
      .eq('email', email.toLowerCase().trim())
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      // Don't reveal if email exists or not — security best practice
      return res.status(200).json({ 
        sent: true, 
        message: 'If we have a licence for that email, we have sent it.' 
      });
    }

    // Send email with licence key
    const planName = data.plan.includes('plus') ? 'Premium Plus' : 'Premium';
    
    {
      await sendEmail({
        to: email.toLowerCase(),
        subject: 'Your Aidova licence key',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
            <h2 style="color:#2D6A4F">Your Aidova Licence Key</h2>
            <p>Here is your Aidova ${planName} licence key:</p>
            <div style="background:#f0fff4;border:2px solid #2D6A4F;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
              <div style="font-size:24px;font-weight:bold;letter-spacing:3px;color:#2D6A4F">${data.licence_key}</div>
            </div>
            <p><strong>To activate Premium on any device:</strong></p>
            <ol>
              <li>Open <a href="https://aidova.app/app">aidova.app/app</a></li>
              <li>Tap ⚙️ Settings</li>
              <li>Tap Plans & Upgrade</li>
              <li>Tap "Have a code? Enter it here"</li>
              <li>Enter your licence key above</li>
            </ol>
            <p style="color:#888;font-size:12px">Please save this key safely. If you need help, email aidovaapp@gmail.com</p>
            <p style="color:#888;font-size:12px">Aidova by CHEWAID® · JMC Collective Ltd</p>
          </div>
        `
      });
    }

    return res.status(200).json({ 
      sent: true,
      message: 'If we have a licence for that email, we have sent it.'
    });

  } catch (err) {
    console.error('Resend licence error:', err);
    return res.status(500).json({ error: err.message });
  }
};
