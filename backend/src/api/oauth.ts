// OAuth flow.
//
// GET  /oauth/install   — generate state, set cookie, redirect to Zoom
// GET  /oauth/callback  — verify state, exchange code, upsert user + config

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { env } from "../env";
import { prisma } from "../infra/db";
import { encryptToken } from "../infra/crypto";
import { fetchZoomUser } from "../infra/zoom";

export const oauthRouter = Router();

oauthRouter.get("/install", (_req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.ZOOM_CLIENT_ID,
    redirect_uri: env.ZOOM_REDIRECT_URI,
    state,
  });

  res.cookie("oauth_state", state, {
    httpOnly: true,
    secure: env.NODE_ENV !== "development",
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
  res.redirect(`https://zoom.us/oauth/authorize?${params.toString()}`);
});

oauthRouter.get("/callback", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const cookieState = req.cookies?.oauth_state ?? readStateCookie(req.headers.cookie);

  if (!code) {
    return res.redirect(`${env.FRONTEND_URL}/?error=no_code`);
  }
  // Only enforce state-match when a cookie is present. Marketplace-initiated
  // installs (which we never hand a state cookie) skip the CSRF check; flows
  // we DID initiate enforce it strictly.
  if (cookieState && cookieState !== state) {
    return res.redirect(`${env.FRONTEND_URL}/?error=state_mismatch`);
  }

  const basic = Buffer.from(
    `${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.ZOOM_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("Token exchange failed:", body);
    return res.redirect(`${env.FRONTEND_URL}/?error=token_exchange`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  let me: Awaited<ReturnType<typeof fetchZoomUser>>;
  try {
    me = await fetchZoomUser(tokens.access_token);
  } catch (err: any) {
    console.error("fetchZoomUser failed:", err?.message);
    return res.redirect(`${env.FRONTEND_URL}/?error=fetch_user`);
  }

  const encryptedAccess = encryptToken(tokens.access_token);
  const encryptedRefresh = encryptToken(tokens.refresh_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { zoomUserId: me.id },
      update: {
        email: me.email,
        displayName: `${me.first_name} ${me.last_name}`.trim(),
        zoomAccountId: me.account_id,
        deauthorizedAt: null,
      },
      create: {
        zoomUserId: me.id,
        zoomAccountId: me.account_id,
        email: me.email,
        displayName: `${me.first_name} ${me.last_name}`.trim(),
      },
    });

    await tx.oauthToken.upsert({
      where: { userId: user.id },
      update: {
        accessTokenCipher: encryptedAccess,
        refreshTokenCipher: encryptedRefresh,
        expiresAt,
        scope: tokens.scope,
      },
      create: {
        userId: user.id,
        accessTokenCipher: encryptedAccess,
        refreshTokenCipher: encryptedRefresh,
        expiresAt,
        scope: tokens.scope,
      },
    });

    // Seed defaults — only on first install. Re-installs keep the user's settings.
    await tx.config.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
  });

  res.clearCookie("oauth_state");
  res.redirect(`${env.FRONTEND_URL}/dashboard?installed=1`);
});

// Express doesn't parse cookies by default and we don't want a whole
// cookie-parser dep for one value.
function readStateCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === "oauth_state") return v;
  }
  return undefined;
}
