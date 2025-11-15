// api/retrieve-session.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * 決済セッション取得
 * GET /api/retrieve-session?session_id=xxx
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { session_id } = req.query || {};

  if (!session_id) {
    return res.status(400).json({ error: "session_id がありません" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    return res.status(200).json({
      id: session.id,
      paid: session.payment_status === "paid",
      amount_total: session.amount_total,
      currency: session.currency,
      metadata: session.metadata || {},
    });
  } catch (err) {
    console.error("retrieve-session error", err);
    return res.status(500).json({
      error: err.message || "Internal Server Error",
    });
  }
}
