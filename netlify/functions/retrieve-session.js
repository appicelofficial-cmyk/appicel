// netlify/functions/retrieve-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    };

    const session_id = (event.queryStringParameters || {}).session_id;
    if (!session_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing session_id' }) };
    }

    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['payment_intent'] });

    const paid =
      session.payment_status === 'paid' ||
      session.status === 'complete' ||
      (session.payment_intent && session.payment_intent.status === 'succeeded');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: session.id,
        paid,
        amount_total: session.amount_total,
        currency: session.currency,
        metadata: session.metadata || {}
      })
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: 'server error' };
  }
};
