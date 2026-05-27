const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
