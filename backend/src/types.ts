// Wire types — kept here as the single source of truth for backend response
// shapes. The frontend mirrors these in frontend/lib/types.ts.

import type { DetectionConfig, DetectionResult } from "./domain/detection";

export type SidebarConfigResponse = {
  config: DetectionConfig;
  enabled: boolean;
  dryRun: boolean;
};

export type DetectRequest = {
  name: string;
  email?: string | null;
  zoomUserId?: string | null;
  isGuest?: boolean;
};

export type DetectResponse = DetectionResult;

export type SidebarEventRequest = {
  zoomUserId?: string;
  meetingId: string;
  meetingUuid?: string;
  participantName?: string;
  participantEmail?: string;
  participantZoomId?: string;
  matchReason: string;
  action:
    | "detected"
    | "removed"
    | "moved_to_waiting_room"
    | "remove_failed"
    | "dry_run";
  latencyMs?: number;
  errorMessage?: string;
};

export type IncidentCycles = {
  detected: number;
  waiting: number;
  removed: number;
  failed: number;
};

export type ActivityRow = {
  id: string;
  meetingId: string;
  whenISO: string;
  name: string | null;
  email: string | null;
  reason: string;
  action: string;
  latency: number | null;
  error: string | null;
  cycles: IncidentCycles;
};

export type MeetingForClient = {
  meetingId: string;
  earliestISO: string;
  latestISO: string;
  counts: {
    total: number;
    detected: number;
    removed: number;
    waiting: number;
    failed: number;
    detectedOnly: number;
  };
  incidents: Array<{
    id: string;
    whenISO: string;
    name: string | null;
    reason: string;
    action: string;
    latency: number | null;
    cycles: IncidentCycles;
  }>;
};

export type HostForClient = {
  email: string;
  displayName: string | null;
  installedAtISO: string;
};

export type DashboardCounts = {
  total: number;
  detected: number;
  removed: number;
  waiting: number;
  failed: number;
  detectedOnly: number;
};

export type DashboardInsight = {
  headline: string;
  body: string;
  topBot?: string;
  topBotPct?: number;
  medianLatencyMs?: number | null;
  failedNotHostCount?: number;
};

export type DashboardResponse = {
  hosts: HostForClient[];
  rows: ActivityRow[];
  meetings: MeetingForClient[];
  counts: {
    total: DashboardCounts;
    week: DashboardCounts;
  };
  monthIncidentCount: number;
  last48hCount: number;
  insight: DashboardInsight | null;
};
