const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const origin = event.headers['origin'] || `https://${event.headers.host}`;
    const { tier, period, cellKey, title } = JSON.parse(event.body || '{}');

    const PRICE = {
      normal: { '1d': 100,  '7d': 600,  '30d': 2500 },
      red:    { '1d': 200,  '7d': 1200, '30d': 5000 },
      rainbow:{ '1d': 300,  '7d': 1800, '30d': 7500 },
    };
    if (!PRICE[tier] || !PRICE[ tier ][ period ]) {
      return { statusCode: 400, body: 'Invalid tier/period' };
    }

    const amount = PRICE[tier][period]; // JPYは最小単位=1円、×100不要
    const name = `Appicel – Cell ${cellKey ? `@(${cellKey}) ` : ''}[${tier}/${period}]`;
    const desc = title ? `Title: ${title}` : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'], // ApplePay/GooglePayもここでOK
      line_items: [{
        price_data: {
          currency: 'jpy',
          product_data: { name, description: desc },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
      metadata: { tier, period, cellKey: cellKey || '', title: title || '' },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Server error' };
  }
};
