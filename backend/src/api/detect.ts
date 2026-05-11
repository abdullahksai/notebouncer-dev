// Pure detection endpoint.
//
// The sidebar POSTs participant facts here and gets a verdict back. No DB
// reads on the hot path — the host's config is fetched in /api/sidebar/config
// and held in memory by the sidebar; this endpoint runs the (stateless)
// detection function against whatever config the caller hands us.
//
// For now we ignore caller-supplied configs and use DEFAULT_CONFIG, mirroring
// what /api/sidebar/config returns. Per-user config wiring is a follow-up.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { detect, DEFAULT_CONFIG } from "../domain/detection";

export const detectRouter = Router();

const DetectBody = z.object({
  name: z.string(),
  email: z.string().nullable().optional(),
  zoomUserId: z.string().nullable().optional(),
  isGuest: z.boolean().optional(),
});

detectRouter.post("/", (req: Request, res: Response) => {
  const parsed = DetectBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  const result = detect(
    {
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      zoomUserId: parsed.data.zoomUserId ?? null,
      isGuest: parsed.data.isGuest,
    },
    DEFAULT_CONFIG
  );
  res.json(result);
});
