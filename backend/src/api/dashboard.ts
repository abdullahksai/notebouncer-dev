// Dashboard data endpoint.
//
// Aggregates everything the frontend dashboard needs: connected hosts, deduped
// incident rows, by-meeting grouping, stats, and the insight blurb. All
// computation lives on the backend so the frontend stays pure UI.

import { Router, type Request, type Response } from "express";
import { prisma } from "../infra/db";
import {
  dedupIncidents,
  countByAction,
  groupByMeeting,
} from "../domain/dedup";
import { generateInsight } from "../domain/insights";
import type {
  ActivityRow,
  DashboardResponse,
  HostForClient,
  MeetingForClient,
} from "../types";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (_req: Request, res: Response) => {
  const [users, allLogs, last48hLogs] = await Promise.all([
    prisma.user.findMany({
      where: { deauthorizedAt: null },
      orderBy: { installedAt: "desc" },
    }),
    // Sidebar-only view: webhook detections are kept for analytics but the
    // user-facing dashboard reports each incident once, from the source that
    // can act on it.
    prisma.auditLog.findMany({
      where: { source: "sidebar" },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.auditLog.findMany({
      where: {
        source: "sidebar",
        createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      },
    }),
  ]);

  const allIncidents = dedupIncidents(allLogs);
  const meetingSummaries = groupByMeeting(allIncidents);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekIncidents = allIncidents.filter(
    (i) => i.earliestAt >= sevenDaysAgo
  );
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  );
  const monthIncidents = allIncidents.filter((i) => i.earliestAt >= monthStart);

  const totalCounts = countByAction(allIncidents);
  const weekCounts = countByAction(weekIncidents);

  const insight = generateInsight(
    allLogs.map((l) => ({
      participantName: l.participantName,
      matchReason: l.matchReason,
      action: l.action,
      latencyMs: l.latencyMs,
      source: l.source,
      errorMessage: l.errorMessage,
      createdAt: l.createdAt,
    }))
  );

  const hosts: HostForClient[] = users.map((u) => ({
    email: u.email,
    displayName: u.displayName,
    installedAtISO: u.installedAt.toISOString(),
  }));

  const rows: ActivityRow[] = allIncidents.slice(0, 200).map((i) => ({
    id: i.id,
    meetingId: i.meetingId,
    whenISO: i.earliestAt.toISOString(),
    name: i.participantName,
    email: i.participantEmail,
    reason: i.matchReason,
    action: i.action,
    latency: i.latencyMs,
    error: i.errorMessage,
    cycles: i.cycles,
  }));

  const meetings: MeetingForClient[] = meetingSummaries.slice(0, 100).map((m) => ({
    meetingId: m.meetingId,
    earliestISO: m.earliestAt.toISOString(),
    latestISO: m.latestAt.toISOString(),
    counts: m.counts,
    incidents: m.incidents.map((i) => ({
      id: i.id,
      whenISO: i.earliestAt.toISOString(),
      name: i.participantName,
      reason: i.matchReason,
      action: i.action,
      latency: i.latencyMs,
      cycles: i.cycles,
    })),
  }));

  const response: DashboardResponse = {
    hosts,
    rows,
    meetings,
    counts: { total: totalCounts, week: weekCounts },
    monthIncidentCount: monthIncidents.length,
    last48hCount: last48hLogs.length,
    insight,
  };
  res.json(response);
});
