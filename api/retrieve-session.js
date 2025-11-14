// api/retrieve-session.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * GET /api/retrieve-session?session_id=cs_...
 */
module.exports = async (req, res) => {
  const q = req.query || {};
  const sessionId = q.session_id;

  if (!sessionId) {
    res.statusCode = 400;
    return res.json({
      error: { code: 'missing', message: 'session_id is required' }
    });
  }

  try {
    const s = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent', 'line_items']
    });

    const paid =
      s.payment_status === 'paid' ||
      (s.status === 'complete' && s.payment_status === 'paid');

    res.statusCode = 200;
    return res.json({
      id: s.id,
      status: s.status,
      payment_status: s.payment_status,
      amount_total: s.amount_total,
      currency: s.currency,
      metadata: s.metadata || null,
      paid
    });
  } catch (err) {
    console.error('retrieve-session error:', err);
    res.statusCode = err.statusCode || 500;
    return res.json({
      error: {
        type: err.type || 'stripe_error',
        code: err.code || 'unknown',
        message: err.message || String(err)
      }
    });
  }
};
