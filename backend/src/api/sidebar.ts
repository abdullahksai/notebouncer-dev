// Sidebar-only endpoints.
//
// GET  /api/sidebar/config?zoomUserId=  — returns per-host detection config
// POST /api/sidebar/event                — sidebar reports a detection/removal

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../infra/db";
import { DEFAULT_CONFIG } from "../domain/detection";

export const sidebarRouter = Router();

sidebarRouter.get("/config", async (req: Request, res: Response) => {
  const zoomUserId =
    typeof req.query.zoomUserId === "string" ? req.query.zoomUserId : null;

  let enabled = true;
  let dryRun = false;
  if (zoomUserId) {
    const user = await prisma.user.findUnique({
      where: { zoomUserId },
      include: { config: true },
    });
    if (user?.config) {
      enabled = user.config.enabled;
      dryRun = user.config.dryRun;
    }
  }

  // Detection logic still ships DEFAULT_CONFIG strictness/patterns. The
  // user-editable bits (allowlist, custom blocklist) get merged in once
  // the Config UI is built.
  res.json({
    config: DEFAULT_CONFIG,
    enabled,
    dryRun,
  });
});

const EventBody = z.object({
  zoomUserId: z.string().optional(),
  meetingId: z.union([z.string(), z.number()]),
  meetingUuid: z.string().optional(),
  participantName: z.string().optional(),
  participantEmail: z.string().optional(),
  participantZoomId: z.string().optional(),
  matchReason: z.string(),
  action: z.string(),
  latencyMs: z.number().optional(),
  errorMessage: z.string().optional(),
});

sidebarRouter.post("/event", async (req: Request, res: Response) => {
  const parsed = EventBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const body = parsed.data;

  // Find the host. Prefer matching by zoomUserId; fall back to most recently
  // installed active user (single-host MVP). Replace with Zoom App context
  // token verification before going multi-tenant.
  let user = null;
  if (body.zoomUserId) {
    user = await prisma.user.findUnique({ where: { zoomUserId: body.zoomUserId } });
  }
  if (!user) {
    user = await prisma.user.findFirst({
      where: { deauthorizedAt: null },
      orderBy: { installedAt: "desc" },
    });
  }
  if (!user) {
    return res.status(404).json({ error: "no_active_user_found" });
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      meetingId: String(body.meetingId),
      meetingUuid: body.meetingUuid ?? null,
      participantName: body.participantName ?? null,
      participantEmail: body.participantEmail ?? null,
      participantZoomId: body.participantZoomId ?? null,
      matchReason: body.matchReason,
      action: body.action,
      latencyMs: typeof body.latencyMs === "number" ? body.latencyMs : null,
      source: "sidebar",
      errorMessage: body.errorMessage ?? null,
    },
  });

  console.log(
    `Sidebar event: ${body.action} ${body.participantName ?? "?"} in meeting ${body.meetingId} (user: ${user.email})`
  );

  res.json({ ok: true });
});
