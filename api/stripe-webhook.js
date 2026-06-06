const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const sgMail = require('@sendgrid/mail');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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

async function sendLicenceEmail(email, licenceKey, planName) {
  await sgMail.send({
    to: email,
    from: 'hello@aidova.app',
    subject: 'Your Aidova licence key — save this safely',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:2rem">💬</div>
          <h1 style="color:#2D6A4F;font-size:1.5rem;margin:8px 0">Welcome to Aidova ${planName}!</h1>
        </div>
        <p>Thank you for subscribing. Your 30-day free trial has started.</p>
        <p>Here is your personal licence key:</p>
        <div style="background:#f0fff4;border:2px solid #2D6A4F;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
          <div style="font-size:1.6rem;font-weight:bold;letter-spacing:4px;color:#2D6A4F;font-family:monospace">${licenceKey}</div>
        </div>
        <p><strong>⚠️ Please save this key safely</strong> — you will need it to activate ${planName} on any device.</p>
        <p><strong>Device limit:</strong> ${planName === 'Premium Plus' ? 'Up to 10 devices' : 'Up to 3 devices'}. To switch devices, remove one from Settings → Plans → Manage devices.</p>
        <p><strong>To activate on any device:</strong></p>
        <ol style="line-height:2">
          <li>Open <a href="https://aidova.app/app" style="color:#2D6A4F">aidova.app/app</a></li>
          <li>Tap ⚙️ Settings</li>
          <li>Tap Plans &amp; Upgrade</li>
          <li>Tap <strong>"Have a code? Enter it here"</strong></li>
          <li>Enter your licence key above</li>
        </ol>
        <p>If you ever lose your key, tap <strong>"Resend my key"</strong> on the Plans screen and enter this email address.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#888;font-size:0.85rem">Your subscription auto-renews after the 30-day trial. Cancel anytime at <a href="mailto:hello@aidova.app" style="color:#2D6A4F">hello@aidova.app</a></p>
        <p style="color:#888;font-size:0.85rem">Aidova by CHEWAID® · JMC Collective Ltd · <a href="https://aidova.app/terms" style="color:#2D6A4F">Terms</a> · <a href="https://aidova.app/privacy" style="color:#2D6A4F">Privacy</a></p>
      </div>
    `
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
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

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || 'premium';
        const deviceLimit = plan === 'premplus' ? 10 : 3;

        if (!email) break;

        // Check if licence already exists for this email + plan
        const { data: existing } = await supabase
          .from('licences')
          .select('licence_key')
          .eq('email', email.toLowerCase())
          .eq('plan', plan)
          .single();

        if (existing) {
          // Reactivate existing licence
          await supabase.from('licences')
            .update({ 
              status: 'active', 
              refunded_at: null,
              stripe_subscription_id: subscriptionId,
              updated_at: new Date().toISOString()
            })
            .eq('licence_key', existing.licence_key);
          await sendLicenceEmail(email, existing.licence_key, plan === 'premplus' ? 'Premium Plus' : 'Premium');
          break;
        }

        // Generate unique key
        let licenceKey;
        let isUnique = false;
        while (!isUnique) {
          licenceKey = generateKey();
          const { data: check } = await supabase
            .from('licences').select('id').eq('licence_key', licenceKey).single();
          if (!check) isUnique = true;
        }

        // Save licence with device limit
        await supabase.from('licences').insert({
          email: email.toLowerCase(),
          licence_key: licenceKey,
          plan: plan,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: 'active',
          device_limit: deviceLimit
        });

        await sendLicenceEmail(email, licenceKey, plan === 'premplus' ? 'Premium Plus' : 'Premium');
        console.log(`Licence created: ${licenceKey} for ${email} (${plan}, ${deviceLimit} devices)`);
        break;
      }

      case 'customer.subscription.deleted':
      case 'customer.subscription.paused': {
        const subscription = event.data.object;
        // Deactivate licence
        await supabase.from('licences')
          .update({ status: 'inactive', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscription.id);
        // Deactivate all devices
        const { data: licence } = await supabase
          .from('licences').select('licence_key')
          .eq('stripe_subscription_id', subscription.id).single();
        if (licence) {
          await supabase.from('licence_devices')
            .update({ is_active: false })
            .eq('licence_key', licence.licence_key);
        }
        break;
      }

      case 'customer.subscription.resumed':
      case 'invoice.payment_succeeded': {
        const obj = event.data.object;
        const subId = obj.subscription || obj.id;
        if (subId) {
          await supabase.from('licences')
            .update({ status: 'active', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subId);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await supabase.from('licences')
            .update({ status: 'inactive', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', invoice.subscription);
          // Deactivate all devices
          const { data: licence } = await supabase
            .from('licences').select('licence_key')
            .eq('stripe_subscription_id', invoice.subscription).single();
          if (licence) {
            await supabase.from('licence_devices')
              .update({ is_active: false })
              .eq('licence_key', licence.licence_key);
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const customerId = charge.customer;
        if (customerId) {
          // Find subscription for this customer
          const { data: licence } = await supabase
            .from('licences').select('licence_key')
            .eq('stripe_customer_id', customerId).single();
          if (licence) {
            // Mark as refunded — deactivates key permanently
            await supabase.from('licences')
              .update({ 
                status: 'inactive',
                refunded_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('licence_key', licence.licence_key);
            // Deactivate all devices immediately
            await supabase.from('licence_devices')
              .update({ is_active: false })
              .eq('licence_key', licence.licence_key);
          }
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
