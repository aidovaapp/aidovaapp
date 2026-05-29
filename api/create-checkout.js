const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  premium_monthly:  'price_1TbpNRI7FTUsbtqREBfAwCZd',
  premium_yearly:   'price_1TbpNRI7FTUsbtqRqFY53VLG',
  premplus_monthly: 'price_1TbpNRI7FTUsbtqR6QU14TSq',
  premplus_yearly:  'price_1TbpNRI7FTUsbtqRqmzoNP8D'
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { plan } = req.body;
    const priceId = PRICES[plan];

    if (!priceId) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://aidova.app/?session_id={CHECKOUT_SESSION_ID}&status=success',
      cancel_url: 'https://aidova.app/?status=cancelled',
      metadata: { plan }
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
