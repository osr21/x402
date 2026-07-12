import { config } from "dotenv";
import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

config();

type Session = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  type: "24hour" | "onetime";
  consumed: boolean;
};

const payTo = process.env.ADDRESS as `0x${string}` | undefined;
const facilitatorUrl = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
const network = (process.env.NETWORK ?? "eip155:84532") as Network;
const port = Number(process.env.PORT ?? "3001");
const corsOrigins = process.env.CORS_ORIGIN?.split(",")
  .map(origin => origin.trim())
  .filter(Boolean) ?? ["http://localhost:5173", "http://127.0.0.1:5173"];

if (!payTo) {
  console.error("ADDRESS is required. Copy .env-local to .env and set a recipient address.");
  process.exit(1);
}

const sessions = new Map<string, Session>();
const pendingConsume = new Set<string>();
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt.getTime() <= now) {
      sessions.delete(id);
      pendingConsume.delete(id);
    }
  }
}, 60_000);

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  network,
  new ExactEvmScheme(),
);

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: corsOrigins,
    credentials: true,
    allowHeaders: ["Content-Type", "PAYMENT-SIGNATURE", "X-PAYMENT"],
    exposeHeaders: ["PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"],
  }),
);

app.use(
  paymentMiddleware(
    {
      "POST /api/pay/session": {
        accepts: { scheme: "exact", price: "$1.00", network, payTo },
        description: "Create a 24-hour browser-wallet example session",
        mimeType: "application/json",
      },
      "POST /api/pay/onetime": {
        accepts: { scheme: "exact", price: "$0.10", network, payTo },
        description: "Create a single-use browser-wallet example token",
        mimeType: "application/json",
      },
    },
    resourceServer,
    {
      appName: "x402 Browser Wallet Example",
      currentUrl: `http://localhost:${port}`,
    },
  ),
);

app.get("/api/health", c =>
  c.json({
    status: "ok",
    config: {
      network,
      payTo,
      facilitatorUrl,
    },
  }),
);

app.post("/api/pay/session", c => {
  const now = new Date();
  const session: Session = {
    id: crypto.randomUUID(),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    type: "24hour",
    consumed: false,
  };
  sessions.set(session.id, session);

  return c.json({
    message: "24-hour access granted.",
    session: {
      id: session.id,
      type: session.type,
      expiresAt: session.expiresAt.toISOString(),
    },
  });
});

app.post("/api/pay/onetime", c => {
  const now = new Date();
  const session: Session = {
    id: crypto.randomUUID(),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    type: "onetime",
    consumed: false,
  };
  sessions.set(session.id, session);

  return c.json({
    message: "One-time access granted.",
    access: {
      id: session.id,
      type: session.type,
      expiresAt: session.expiresAt.toISOString(),
      validFor: "5 minutes",
    },
  });
});

app.get("/api/session/:sessionId", c => {
  const sessionId = c.req.param("sessionId");
  const session = sessions.get(sessionId);

  if (!session) {
    return c.json({ valid: false, error: "Session not found." }, 404);
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    sessions.delete(sessionId);
    pendingConsume.delete(sessionId);
    return c.json({ valid: false, error: "Session expired." }, 410);
  }

  if (session.type === "onetime" && session.consumed) {
    return c.json({ valid: false, error: "Session already consumed." }, 409);
  }

  return c.json({
    valid: true,
    session: {
      id: session.id,
      type: session.type,
      expiresAt: session.expiresAt.toISOString(),
      remainingTime: session.expiresAt.getTime() - Date.now(),
    },
  });
});

app.post("/api/session/:sessionId/consume", c => {
  const sessionId = c.req.param("sessionId");
  const session = sessions.get(sessionId);

  if (!session) {
    return c.json({ success: false, error: "Session not found." }, 404);
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    sessions.delete(sessionId);
    pendingConsume.delete(sessionId);
    return c.json({ success: false, error: "Session expired." }, 410);
  }

  if (session.type === "24hour") {
    return c.json({ success: true, type: session.type });
  }

  if (session.consumed || pendingConsume.has(sessionId)) {
    return c.json({ success: false, error: "Session already consumed or in use." }, 409);
  }

  pendingConsume.add(sessionId);

  try {
    session.consumed = true;
    sessions.set(sessionId, session);
    return c.json({ success: true, type: session.type });
  } finally {
    pendingConsume.delete(sessionId);
  }
});

const server = serve({ fetch: app.fetch, port });

server.on("close", () => {
  clearInterval(cleanupTimer);
});

console.log(`x402 browser-wallet server listening on http://localhost:${port}`);
