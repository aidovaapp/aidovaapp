const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  premium_monthly:  'price_1TbjZSI4ZXfX5JkkurrbZC24',
  premium_yearly:   'price_1TbjaII4ZXfX5JkkcNyusCNq',
  premplus_monthly: 'price_1TbjbgI4ZXfX5JkkfSEsYpPb',
  premplus_yearly:  'price_1TbjcHI4ZXfX5Jkk1RyuHOy8'
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { plan } = JSON.parse(event.body);
    const priceId = PRICES[plan];

    if (!priceId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid plan' })
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://aidovaapp.github.io/aidovaapp/?session_id={CHECKOUT_SESSION_ID}&status=success',
      cancel_url: 'https://aidovaapp.github.io/aidovaapp/?status=cancelled',
      metadata: { plan }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url, sessionId: session.id })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
