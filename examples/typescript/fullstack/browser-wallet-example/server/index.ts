import { config } from "dotenv";
  import { Hono } from "hono";
  import { serve } from "@hono/node-server";
  import { cors } from "hono/cors";
  import { paymentMiddleware, Network, Resource } from "x402-hono";
  import { v4 as uuidv4 } from "uuid";

  config();

  const facilitatorUrl = process.env.FACILITATOR_URL as Resource || "https://x402.org/facilitator";
  const payTo = process.env.ADDRESS as `0x${string}`;
  const network = (process.env.NETWORK as Network) || "base-sepolia";
  const port = parseInt(process.env.PORT || "3001");
  const corsOrigin = process.env.CORS_ORIGIN?.split(",").map(s => s.trim()) || [
    "http://localhost:5173",
    "http://localhost:3000",
  ];

  if (!payTo) {
    console.error("❌ Please set your wallet ADDRESS in the .env file");
    process.exit(1);
  }

  if (network !== "base-sepolia" && !process.env.FACILITATOR_URL) {
    console.error("❌ Non-testnet network requires an explicit FACILITATOR_URL (e.g. https://api.cdp.coinbase.com/platform/v2/x402)");
    process.exit(1);
  }

  const app = new Hono();

  app.use("/*", cors({ origin: corsOrigin, credentials: true }));

  interface Session {
    id: string;
    payer: string;            // address that made the on-chain payment — binds session to wallet
    createdAt: Date;
    expiresAt: Date;
    type: "24hour" | "onetime";
    consumed?: boolean;
  }

  const sessions = new Map<string, Session>();

  // Two-set atomic gate: prevents concurrent double-consume of one-time sessions.
  // A ref moves: absent → pendingConsume → consumed (permanent).
  const pendingConsume = new Set<string>();
  const consumed = new Set<string>();

  // Prune expired sessions periodically so the map doesn't grow unbounded.
  setInterval(() => {
    const now = new Date();
    for (const [id, s] of sessions) {
      if (now > s.expiresAt) sessions.delete(id);
    }
  }, 60_000);

  app.use(
    paymentMiddleware(
      payTo,
      {
        "/api/pay/session": { price: "$1.00", network },
        "/api/pay/onetime": { price: "$0.10", network },
      },
      { url: facilitatorUrl },
    ),
  );

  app.get("/api/health", (c) => {
    return c.json({ status: "ok", config: { network, payTo, facilitator: facilitatorUrl } });
  });

  app.get("/api/payment-options", (c) => {
    return c.json({
      options: [
        { name: "24-Hour Access", endpoint: "/api/pay/session",  price: "$1.00", description: "Session token valid for 24 hours" },
        { name: "One-Time Access", endpoint: "/api/pay/onetime", price: "$0.10", description: "Single-use token, valid for 5 minutes" },
      ],
    });
  });

  // Extract payer address from x402 payment response header (set by x402-hono after settlement).
  // Falls back to a sentinel so sessions always have a payer field.
  function extractPayer(c: any): string {
    // x402-hono sets x-payment-response after verifying settlement.
    // The payload contains the from address embedded in the signed authorization.
    try {
      const raw = c.req.header("x-payment-response");
      if (raw) {
        const decoded = JSON.parse(Buffer.from(raw, "base64").toString());
        return decoded?.from ?? decoded?.payer ?? "unknown";
      }
    } catch {}
    return "unknown";
  }

  // Paid: 24-hour session
  app.post("/api/pay/session", (c) => {
    const payer = extractPayer(c);
    const now = new Date();
    const session: Session = {
      id: uuidv4(),
      payer,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      type: "24hour",
    };
    sessions.set(session.id, session);
    return c.json({
      success: true,
      sessionId: session.id,
      message: "24-hour access granted!",
      session: { id: session.id, type: "24hour", expiresAt: session.expiresAt.toISOString() },
    });
  });

  // Paid: one-time access
  app.post("/api/pay/onetime", (c) => {
    const payer = extractPayer(c);
    const now = new Date();
    const session: Session = {
      id: uuidv4(),
      payer,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      type: "onetime",
      consumed: false,
    };
    sessions.set(session.id, session);
    return c.json({
      success: true,
      sessionId: session.id,
      message: "One-time access granted!",
      access: { id: session.id, type: "onetime", validFor: "5 minutes (single use)" },
    });
  });

  // Free: read-only status check — does NOT consume the session.
  app.get("/api/session/:sessionId", (c) => {
    const id = c.req.param("sessionId");
    const session = sessions.get(id);
    if (!session) return c.json({ valid: false, error: "Session not found" }, 404);

    const now = new Date();
    const expired = now > session.expiresAt;
    const isConsumed = consumed.has(id) || session.consumed;

    if (expired || isConsumed) {
      return c.json({ valid: false, error: expired ? "Session expired" : "Already used" });
    }
    return c.json({
      valid: true,
      session: {
        id: session.id,
        type: session.type,
        expiresAt: session.expiresAt.toISOString(),
        remainingTime: session.expiresAt.getTime() - now.getTime(),
      },
    });
  });

  // Explicit consume endpoint — atomic, idempotent on the "already used" path.
  // Call this when you actually want to grant access, not on every status check.
  app.post("/api/session/:sessionId/consume", (c) => {
    const id = c.req.param("sessionId");

    // Atomic gate: block if already in-flight or permanently consumed.
    if (pendingConsume.has(id) || consumed.has(id)) {
      return c.json({ success: false, error: "Session already consumed or in use" }, 409);
    }

    const session = sessions.get(id);
    if (!session) return c.json({ success: false, error: "Session not found" }, 404);

    const now = new Date();
    if (now > session.expiresAt) return c.json({ success: false, error: "Session expired" }, 410);
    if (session.consumed) return c.json({ success: false, error: "Already consumed" }, 409);

    // Mark in-flight before any async work.
    pendingConsume.add(id);

    try {
      if (session.type === "onetime") {
        // Permanently consume.
        consumed.add(id);
        session.consumed = true;
        sessions.set(id, session);
      }
      return c.json({ success: true, type: session.type });
    } finally {
      pendingConsume.delete(id);
    }
  });

  serve({ fetch: app.fetch, port });
  console.log(`🚀 x402 server on :${port} | network: ${network} | payTo: ${payTo}`);
  