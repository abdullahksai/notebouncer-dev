// Frontend-side type mirrors of the backend's API response shapes.
// Keeping these duplicated (rather than importing from backend) avoids
// coupling the workspaces and keeps the frontend's TS compile self-contained.
// If the backend changes a wire shape, update both files in lockstep.

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

export type DetectionResult =
  | { match: false }
  | { match: true; reason: string; confidence: "high" | "medium" };

export type DetectionConfig = {
  strictness: "strict" | "balanced" | "lenient";
  customBlocklistNames: string[];
  customBlocklistDomains: string[];
  allowlistNames: string[];
  allowlistEmails: string[];
};

export type SidebarConfigResponse = {
  config: DetectionConfig;
  enabled: boolean;
  dryRun: boolean;
};

export type SidebarEventRequest = {
  zoomUserId?: string | null;
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
