// Shared email sender using Resend (https://resend.com).
// Files starting with "_" inside /api are not exposed as endpoints by Vercel.
// Needs the RESEND_API_KEY environment variable in Vercel, and aidova.app
// verified as a sending domain in Resend.

const FROM = 'Aidova Support <hello@aidova.app>';
const REPLY_TO = 'aidovaapp@gmail.com';

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend error ${response.status}: ${detail}`);
  }
  return response.json();
}

module.exports = { sendEmail };
