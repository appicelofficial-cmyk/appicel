const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const origin = event.headers['origin'] || `https://${event.headers.host}`;
  try {
    const sessionId = event.queryStringParameters?.session_id;
    if (!sessionId) return { statusCode: 400, body: 'Missing session_id' };

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === 'paid';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin },
      body: JSON.stringify({
        paid,
        amount_total: session.amount_total,
        currency: session.currency,
        metadata: session.metadata || {},
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Server error' };
  }
};
