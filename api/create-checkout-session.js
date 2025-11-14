// api/create-checkout-session.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * POST /api/create-checkout-session
 * body: { priceId, metadata }
 */
module.exports = async (req, res) => {
  // VercelのNode APIは req.method / req.body / req.query が使える
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: body.priceId, // 例: price_XXXXXX
          quantity: 1
        }
      ],
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/`,
      metadata: body.metadata || {}
    });

    res.statusCode = 200;
    return res.json({ id: session.id });
  } catch (e) {
    console.error('create-checkout-session error:', e);
    res.statusCode = e.statusCode || 500;
    return res.json({ error: e.message || 'server error' });
  }
};
