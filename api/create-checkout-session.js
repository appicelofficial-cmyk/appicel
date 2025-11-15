// api/create-checkout-session.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * 決済セッション作成
 * POST /api/create-checkout-session
 * body: { priceId, metadata: { cellKey, period, tier, title } }
 */
export default async function handler(req, res) {
  // POST 以外は拒否
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { priceId, metadata } = req.body || {};

    if (!priceId) {
      return res.status(400).json({ error: "priceId がありません" });
    }

    // success / cancel URL は現在のドメインから組み立て
    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
      metadata: metadata || {},
    });

    // フロント側はこの url にリダイレクト
    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error("create-checkout-session error", err);
    return res.status(500).json({
      error: err.message || "Internal Server Error",
    });
  }
}
