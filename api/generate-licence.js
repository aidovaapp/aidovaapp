const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = 'AID-';
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      key += chars[Math.floor(Math.random() * chars.length)];
    }
    if (i < 2) key += '-';
  }
  return key; // e.g. AID-7X9K-2M4P-8Q3R
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, plan, stripeCustomerId, stripeSubscriptionId } = req.body;

    if (!email || !plan) {
      return res.status(400).json({ error: 'Missing email or plan' });
    }

    // Check if licence already exists for this email + plan
    const { data: existing } = await supabase
      .from('licences')
      .select('licence_key')
      .eq('email', email.toLowerCase())
      .eq('plan', plan)
      .single();

    if (existing) {
      return res.status(200).json({ 
        licence_key: existing.licence_key,
        already_exists: true 
      });
    }

    // Generate unique key
    let licenceKey;
    let isUnique = false;
    while (!isUnique) {
      licenceKey = generateKey();
      const { data: check } = await supabase
        .from('licences')
        .select('id')
        .eq('licence_key', licenceKey)
        .single();
      if (!check) isUnique = true;
    }

    // Save to database
    const { error } = await supabase
      .from('licences')
      .insert({
        email: email.toLowerCase(),
        licence_key: licenceKey,
        plan: plan,
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId || null,
        status: 'active'
      });

    if (error) throw error;

    return res.status(200).json({ licence_key: licenceKey });

  } catch (err) {
    console.error('Generate licence error:', err);
    return res.status(500).json({ error: err.message });
  }
};
