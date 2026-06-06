const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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
  return key;
}

const PRICE_TO_PLAN = {
  'price_1TbpNRI7FTUsbtqREBfAwCZd': 'premium',
  'price_1TbpNRI7FTUsbtqRqFY53VLG': 'premium',
  'price_1TbpNRI7FTUsbtqR6QU14TSq': 'premplus',
  'price_1TbpNRI7FTUsbtqRqmzoNP8D': 'premplus'
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;

        const email = session.customer_details?.email;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Get the plan from subscription
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || 'premium';

        if (!email) break;

        // Check if licence already exists
        const { data: existing } = await supabase
          .from('licences')
          .select('licence_key')
          .eq('email', email.toLowerCase())
          .eq('plan', plan)
          .single();

        if (existing) break; // Already has a licence

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

        // Save licence
        await supabase.from('licences').insert({
          email: email.toLowerCase(),
          licence_key: licenceKey,
          plan: plan,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: 'active'
        });

        // Send welcome email with licence key
        // Using fetch to call our own resend endpoint would create a loop
        // Instead send directly via SendGrid
        console.log(`Licence created: ${licenceKey} for ${email} (${plan})`);
        // TODO: Send email via SendGrid with licence key
        // Email template same as resend-licence.js

        break;
      }

      case 'customer.subscription.deleted':
      case 'customer.subscription.paused': {
        const subscription = event.data.object;
        await supabase
          .from('licences')
          .update({ status: 'inactive', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      case 'customer.subscription.resumed':
      case 'invoice.payment_succeeded': {
        const obj = event.data.object;
        const subId = obj.subscription || obj.id;
        if (subId) {
          await supabase
            .from('licences')
            .update({ status: 'active', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subId);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await supabase
            .from('licences')
            .update({ status: 'inactive', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', invoice.subscription);
        }
        break;
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
