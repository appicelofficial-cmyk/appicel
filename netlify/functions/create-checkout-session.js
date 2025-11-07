// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * 受け取るJSON:
 * { tier: "normal"|"red"|"rainbow", period: "1d"|"7d"|"30d", cellKey: "x,y", title: "任意" }
 */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const origin = event.headers['origin'] || `https://${event.headers.host}`;
    const { tier, period, cellKey, title } = JSON.parse(event.body || '{}');

    // ←← ここに あなたの Stripe Price ID を貼る（9個）
    const PRICE_IDS = {
      normal:  { '1d': 'price_1SQreD3vSReOzkVxyOz0wodi', '7d': 'price_1SQrfO3vSReOzkVxlzogrJqD', '30d': 'price_1SQrg53vSReOzkVxSfD3PhoL' },
      red:     { '1d': 'price_1SQrgd3vSReOzkVxY4ODaqpe', '7d': 'price_1SQrgy3vSReOzkVxvvNIXtf5', '30d': 'price_1SQrhQ3vSReOzkVxR8DtuaeO' },
      rainbow: { '1d': 'price_1SQrhl3vSReOzkVxSRPFUGjh', '7d': 'price_1SQriH3vSReOzkVxNylPFUzH', '30d': 'price_1SQrie3vSReOzkVxYlD4vyPW' },
    };

    if (!PRICE_IDS[tier] || !PRICE_IDS[tier][period]) {
      return { statusCode: 400, body: 'Invalid tier/period' };
    }

    const priceId = PRICE_IDS[tier][period];
    const name = `Appicel – Cell ${cellKey ? `@(${cellKey}) ` : ''}[${tier}/${period}]`;
    const desc = title ? `Title: ${title}` : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'], // Apple Pay / Google Pay もOK
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
      metadata: { tier, period, cellKey: cellKey || '', title: title || '' },
      custom_text: { submit: { message: desc } }, // 任意：決済画面に軽いメモを表示
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin
      },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Server error' };
  }
};
