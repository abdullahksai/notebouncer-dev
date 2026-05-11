// Zoom webhook receiver.
//
// Inline processing (no queue yet — see plan): on participant_joined we run
// detection and write audit_log; on app_deauthorized we tear down tokens.
// All events go through HMAC verification and the webhook_events dedup table.

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { env } from "../env";
import { prisma } from "../infra/db";
import { detect, DEFAULT_CONFIG } from "../domain/detection";

export const webhookRouter = Router();

webhookRouter.post("/", async (req: Request, res: Response) => {
  // express.raw mounts body as a Buffer. Stringify it for HMAC + parse.
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body);

  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  // URL validation handshake — Zoom sends this when you click Validate in
  // the Marketplace event subscriptions UI.
  if (parsed?.event === "endpoint.url_validation") {
    const plainToken = parsed.payload?.plainToken;
    if (typeof plainToken !== "string") {
      return res.status(400).json({ error: "missing_plain_token" });
    }
    const encryptedToken = crypto
      .createHmac("sha256", env.ZOOM_WEBHOOK_SECRET)
      .update(plainToken)
      .digest("hex");
    return res.json({ plainToken, encryptedToken });
  }

  if (!verifySignature(req, rawBody)) {
    return res.status(401).json({ error: "bad_signature" });
  }

  // Dedup. Zoom retries on non-2xx, so the same event may arrive multiple
  // times. The event_ts + payload give us a stable id even when Zoom doesn't
  // provide one explicitly.
  const eventId =
    typeof parsed.event_id === "string" && parsed.event_id.length > 0
      ? parsed.event_id
      : `${parsed.event}:${parsed.event_ts ?? ""}:${parsed.payload?.object?.uuid ?? parsed.payload?.user_id ?? ""}:${parsed.payload?.object?.participant?.id ?? ""}`;

  try {
    await prisma.webhookEvent.create({ data: { zoomEventId: eventId } });
  } catch (err: any) {
    // Unique violation = already processed. Respond 200 so Zoom stops retrying.
    if (err?.code === "P2002") {
      return res.json({ ok: true, duplicate: true });
    }
    throw err;
  }

  if (parsed.event === "app_deauthorized") {
    await handleDeauth(parsed.payload);
    return res.json({ ok: true });
  }

  if (parsed.event === "meeting.participant_joined") {
    const receivedAt = Date.now();
    await handleParticipantJoined(parsed.payload, receivedAt);
  }

  res.json({ ok: true });
});

function verifySignature(req: Request, rawBody: string): boolean {
  const ts = req.headers["x-zm-request-timestamp"];
  const sig = req.headers["x-zm-signature"];
  if (typeof ts !== "string" || typeof sig !== "string") return false;
  // 5-minute replay window.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const message = `v0:${ts}:${rawBody}`;
  const hash = crypto
    .createHmac("sha256", env.ZOOM_WEBHOOK_SECRET)
    .update(message)
    .digest("hex");
  const expected = `v0=${hash}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function handleDeauth(payload: any) {
  const zoomUserId = payload?.user_id;
  if (!zoomUserId) return;
  const user = await prisma.user.findUnique({ where: { zoomUserId } });
  if (!user) return;
  await prisma.$transaction([
    prisma.oauthToken.deleteMany({ where: { userId: user.id } }),
    prisma.user.update({
      where: { id: user.id },
      data: { deauthorizedAt: new Date() },
    }),
  ]);
}

async function handleParticipantJoined(payload: any, receivedAt: number) {
  const meetingId = payload?.object?.id;
  const meetingUuid = payload?.object?.uuid;
  const hostId = payload?.object?.host_id;
  const p = payload?.object?.participant;
  if (!meetingId || !hostId || !p) return;

  const user = await prisma.user.findUnique({ where: { zoomUserId: hostId } });
  if (!user || user.deauthorizedAt) return;

  // Record the meeting on first sight (idempotent via unique constraint).
  if (meetingUuid) {
    await prisma.meeting
      .upsert({
        where: {
          userId_meetingUuid: { userId: user.id, meetingUuid: String(meetingUuid) },
        },
        update: {},
        create: { userId: user.id, meetingUuid: String(meetingUuid) },
      })
      .catch((err) => console.error("meeting upsert failed:", err));
  }

  const result = detect(
    {
      name: p.user_name,
      email: p.email ?? null,
      zoomUserId: p.id,
      isGuest: !p.email,
    },
    DEFAULT_CONFIG
  );

  if (!result.match) return;

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      meetingId: String(meetingId),
      meetingUuid: meetingUuid ? String(meetingUuid) : null,
      participantName: p.user_name,
      participantEmail: p.email ?? null,
      participantZoomId: p.id,
      matchReason: result.reason,
      action: "detected",
      latencyMs: Date.now() - receivedAt,
      source: "webhook",
    },
  });

  console.log(
    `Bot detected via webhook: ${p.user_name} in meeting ${meetingId}`
  );
}
