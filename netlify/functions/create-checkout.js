const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  premium_monthly:  'price_1TbpNRI7FTUsbtqREBfAwCZd',
  premium_yearly:   'price_1TbpNRI7FTUsbtqRqFY53VLG',
  premplus_monthly: 'price_1TbpNRI7FTUsbtqR6QU14TSq',
  premplus_yearly:  'price_1TbpNRI7FTUsbtqRqmzoNP8D'
};

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigins = ['https://aidova.app','https://www.aidova.app','https://aidovaapp.github.io'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : 'https://aidova.app';

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
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
      success_url: 'https://aidova.app/?session_id={CHECKOUT_SESSION_ID}&status=success',
      cancel_url: 'https://aidova.app/?status=cancelled',
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
