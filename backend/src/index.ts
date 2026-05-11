// Express server bootstrap. Wires CORS, body parsers, and the route handlers.
//
// /webhook/zoom needs raw body access for HMAC verification, so it's mounted
// BEFORE express.json() and uses its own raw parser.

import express from "express";
import cors from "cors";
import { env } from "./env";
import { oauthRouter } from "./api/oauth";
import { webhookRouter } from "./api/webhook";
import { detectRouter } from "./api/detect";
import { sidebarRouter } from "./api/sidebar";
import { dashboardRouter } from "./api/dashboard";

const app = express();

// Permissive CORS for the configured frontend origin. Webhook + OAuth are
// browser-driven top-level navigations, not XHR — they don't need CORS.
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);

// Webhook gets raw-body BEFORE json parser so HMAC sees byte-for-byte payload.
app.use("/webhook/zoom", express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use("/oauth", oauthRouter);
app.use("/webhook/zoom", webhookRouter);
app.use("/api/detect", detectRouter);
app.use("/api/sidebar", sidebarRouter);
app.use("/api/dashboard", dashboardRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(env.PORT, () => {
  console.log(`NoteBouncer backend listening on :${env.PORT}`);
  console.log(`  Frontend origin: ${env.FRONTEND_URL}`);
  console.log(`  OAuth redirect:  ${env.ZOOM_REDIRECT_URI}`);
});
