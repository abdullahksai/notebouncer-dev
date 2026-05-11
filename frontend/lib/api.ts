// Typed backend client.
//
// Two URL knobs because Next.js has two execution contexts:
//   - NEXT_PUBLIC_BACKEND_URL → used in the browser (sidebar)
//   - BACKEND_INTERNAL_URL    → used in server components (dashboard RSC).
// Usually identical in dev; can differ in prod (e.g. internal LB vs. public DNS).

import type {
  DashboardResponse,
  DetectionResult,
  SidebarConfigResponse,
  SidebarEventRequest,
} from "./types";

function publicBase(): string {
  const url = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_BACKEND_URL is not set. Add it to frontend/.env.local."
    );
  }
  return url.replace(/\/$/, "");
}

function serverBase(): string {
  const url = process.env.BACKEND_INTERNAL_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!url) {
    throw new Error(
      "BACKEND_INTERNAL_URL / NEXT_PUBLIC_BACKEND_URL is not set."
    );
  }
  return url.replace(/\/$/, "");
}

/** Browser-side: ask the backend whether a participant is a bot. */
export async function detectParticipant(params: {
  name: string;
  email?: string | null;
  zoomUserId?: string | null;
  isGuest?: boolean;
}): Promise<DetectionResult> {
  const res = await fetch(`${publicBase()}/api/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`detect_failed:${res.status}`);
  }
  return res.json();
}

/** Browser-side: fetch the current host's sidebar config. */
export async function getSidebarConfig(
  zoomUserId?: string | null
): Promise<SidebarConfigResponse> {
  const qs = zoomUserId ? `?zoomUserId=${encodeURIComponent(zoomUserId)}` : "";
  const res = await fetch(`${publicBase()}/api/sidebar/config${qs}`);
  if (!res.ok) {
    throw new Error(`sidebar_config_failed:${res.status}`);
  }
  return res.json();
}

/** Browser-side: report a detection or removal action. */
export async function postSidebarEvent(body: SidebarEventRequest): Promise<void> {
  const res = await fetch(`${publicBase()}/api/sidebar/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`sidebar_event_failed:${res.status}:${text.slice(0, 100)}`);
  }
}

/** Server-side (RSC): fetch the dashboard payload. */
export async function fetchDashboard(): Promise<DashboardResponse> {
  const res = await fetch(`${serverBase()}/api/dashboard`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`dashboard_failed:${res.status}:${text.slice(0, 200)}`);
  }
  return res.json();
}
