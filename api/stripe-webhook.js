const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const sgMail = require('@sendgrid/mail');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Device limits — must match verify-licence.js and the Plans/Help copy
const PREMIUM_DEVICE_LIMIT = 3;
const PREMPLUS_DEVICE_LIMIT = 5;

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

// Stripe's signature check needs the request body exactly as Stripe sent it.
// Vercel parses JSON bodies automatically, which changes the bytes and makes
// every signature check fail (HTTP 400). Read the untouched raw body instead.
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const PRICE_TO_PLAN = {
  'price_1TbpNRI7FTUsbtqREBfAwCZd': 'premium',
  'price_1TbpNRI7FTUsbtqRqFY53VLG': 'premium',
  'price_1TbpNRI7FTUsbtqR6QU14TSq': 'premplus',
  'price_1TbpNRI7FTUsbtqRqmzoNP8D': 'premplus'
};

// Throws if Supabase returned an error, so Stripe retries the event later
// (e.g. while a paused Supabase project is waking up).
function check(result, what) {
  if (result.error && result.error.code !== 'PGRST116') { // PGRST116 = no rows found
    throw new Error(`${what}: ${result.error.message}`);
  }
  return result.data;
}

async function sendLicenceEmail(email, licenceKey, planName) {
  const deviceLimit = planName === 'Premium Plus' ? PREMPLUS_DEVICE_LIMIT : PREMIUM_DEVICE_LIMIT;
  await sgMail.send({
    to: email,
    from: { email: 'hello@aidova.app', name: 'Aidova Support' },
    replyTo: 'aidovaapp@gmail.com',
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
        <p><strong>Device limit:</strong> Up to ${deviceLimit} devices.</p>
        <p><strong>To activate on any device:</strong></p>
        <ol style="line-height:2">
          <li>Open <a href="https://aidova.app/app" style="color:#2D6A4F">aidova.app/app</a> or the Aidova Android app</li>
          <li>Tap ⚙️ Settings</li>
          <li>Tap Plans &amp; Upgrade</li>
          <li>Tap <strong>"Have a code? Enter it here"</strong></li>
          <li>Enter your licence key above</li>
        </ol>
        <p>If you ever lose your key, tap <strong>"Resend my key"</strong> on the Plans screen and enter this email address.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#888;font-size:0.85rem">Your subscription auto-renews after the 30-day trial. To cancel, reply to this email or contact <a href="mailto:aidovaapp@gmail.com" style="color:#2D6A4F">aidovaapp@gmail.com</a></p>
        <p style="color:#888;font-size:0.85rem">Aidova by CHEWAID® · JMC Collective Ltd · <a href="https://aidova.app/terms" style="color:#2D6A4F">Terms</a> · <a href="https://aidova.app/privacy" style="color:#2D6A4F">Privacy</a></p>
      </div>
    `
  });
}

// Newer Stripe API versions (2025-03-31+) moved the subscription ID on invoices
function invoiceSubscriptionId(invoice) {
  return invoice.subscription
    || invoice.parent?.subscription_details?.subscription
    || null;
}

async function deactivateLicence(filterColumn, filterValue, extraFields) {
  const licence = check(
    await supabase.from('licences').select('licence_key').eq(filterColumn, filterValue).maybeSingle(),
    'find licence'
  );
  if (!licence) return;
  check(
    await supabase.from('licences')
      .update({ status: 'inactive', updated_at: new Date().toISOString(), ...(extraFields || {}) })
      .eq('licence_key', licence.licence_key),
    'deactivate licence'
  );
  check(
    await supabase.from('licence_devices')
      .update({ is_active: false })
      .eq('licence_key', licence.licence_key),
    'deactivate devices'
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
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
        if (!email) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        // Stripe retries failed events for up to 3 days. If the subscription has
        // been cancelled since (e.g. a duplicate sign-up), don't issue a key.
        if (!['trialing', 'active'].includes(subscription.status)) {
          console.log(`Skipping licence for ${email}: subscription ${subscriptionId} is ${subscription.status}`);
          break;
        }

        const priceId = subscription.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || 'premium';
        const deviceLimit = plan === 'premplus' ? PREMPLUS_DEVICE_LIMIT : PREMIUM_DEVICE_LIMIT;
        const planName = plan === 'premplus' ? 'Premium Plus' : 'Premium';

        // Existing licence for this email + plan? Reactivate it and resend the same key.
        const existing = check(
          await supabase.from('licences').select('licence_key')
            .eq('email', email.toLowerCase()).eq('plan', plan).maybeSingle(),
          'look up existing licence'
        );

        if (existing) {
          check(
            await supabase.from('licences').update({
              status: 'active',
              refunded_at: null,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              updated_at: new Date().toISOString()
            }).eq('licence_key', existing.licence_key),
            'reactivate licence'
          );
          await sendLicenceEmail(email, existing.licence_key, planName);
          console.log(`Licence reactivated: ${existing.licence_key} for ${email} (${plan})`);
          break;
        }

        // Generate a unique key
        let licenceKey;
        for (let tries = 0; tries < 10; tries++) {
          const candidate = generateKey();
          const clash = check(
            await supabase.from('licences').select('id').eq('licence_key', candidate).maybeSingle(),
            'check key uniqueness'
          );
          if (!clash) { licenceKey = candidate; break; }
        }
        if (!licenceKey) throw new Error('Could not generate a unique licence key');

        check(
          await supabase.from('licences').insert({
            email: email.toLowerCase(),
            licence_key: licenceKey,
            plan: plan,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            status: 'active',
            device_limit: deviceLimit
          }),
          'save licence'
        );

        await sendLicenceEmail(email, licenceKey, planName);
        console.log(`Licence created: ${licenceKey} for ${email} (${plan}, ${deviceLimit} devices)`);
        break;
      }

      case 'customer.subscription.deleted':
      case 'customer.subscription.paused': {
        await deactivateLicence('stripe_subscription_id', event.data.object.id);
        break;
      }

      case 'customer.subscription.resumed':
      case 'invoice.payment_succeeded': {
        const obj = event.data.object;
        const subId = event.type === 'customer.subscription.resumed' ? obj.id : invoiceSubscriptionId(obj);
        if (subId) {
          check(
            await supabase.from('licences')
              .update({ status: 'active', updated_at: new Date().toISOString() })
              .eq('stripe_subscription_id', subId),
            'activate licence'
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const subId = invoiceSubscriptionId(event.data.object);
        if (subId) {
          await deactivateLicence('stripe_subscription_id', subId);
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        if (charge.customer) {
          await deactivateLicence('stripe_customer_id', charge.customer, { refunded_at: new Date().toISOString() });
        }
        break;
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    // 500 tells Stripe to retry this event later
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
