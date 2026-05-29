const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    const { sessionId } = JSON.parse(event.body);

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription']
    });

    if (session.payment_status !== 'paid') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ valid: false })
      };
    }

    const plan = session.metadata.plan;
    const sub = session.subscription;
    const expiresAt = sub ? sub.current_period_end * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
    const isPremPlus = plan && plan.startsWith('premplus');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        valid: true,
        plan,
        isPremPlus,
        isPremium: !isPremPlus,
        expiresAt,
        subscriptionId: sub ? sub.id : null,
        customerId: session.customer
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
