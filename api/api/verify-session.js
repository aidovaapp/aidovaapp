const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { sessionId } = req.body;

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription']
    });

    if (session.payment_status !== 'paid') {
      return res.status(200).json({ valid: false });
    }

    const plan = session.metadata.plan;
    const sub = session.subscription;
    const expiresAt = sub ? sub.current_period_end * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
    const isPremPlus = plan && plan.startsWith('premplus');

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
    return res.status(500).json({ error: err.message });
  }
};
