const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Called by app.html straight after Stripe Checkout returns the customer to
// aidova.app/app?session_id=...&status=success
// Checkout for a free trial collects no money, so payment_status is
// 'no_payment_required' rather than 'paid'; both mean the sign-up succeeded.
const allowedOrigins = ['https://aidova.app', 'https://www.aidova.app', 'https://aidovaapp.vercel.app'];

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : 'https://aidova.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { sessionId } = req.body || {};
    if (!sessionId || !String(sessionId).startsWith('cs_')) {
      return res.status(200).json({ valid: false });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });

    const completed = session.status === 'complete'
      && (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
    const sub = session.subscription;
    const subOk = !sub || ['trialing', 'active'].includes(sub.status);

    if (!completed || !subOk) {
      return res.status(200).json({ valid: false });
    }

    const plan = session.metadata && session.metadata.plan;
    const isPremPlus = !!(plan && plan.startsWith('premplus'));
    const periodEnd = sub && (sub.current_period_end || sub.items?.data?.[0]?.current_period_end);
    const expiresAt = periodEnd ? periodEnd * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;

    return res.status(200).json({
      valid: true,
      plan,
      isPremPlus,
      isPremium: !isPremPlus,
      expiresAt,
      subscriptionId: sub ? sub.id : null,
      customerId: session.customer
    });
  } catch (err) {
    console.error('verify-session error:', err.message);
    return res.status(500).json({ error: 'Could not verify session' });
  }
};
