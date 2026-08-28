import { asc, eq } from "drizzle-orm";
import { getDb, type Database } from "../../db";
import { homebaseJobMappings, homebaseShifts, homebaseUserMappings, routes, teamMembers } from "../../db/schema";
import { parseHomebaseAssignment } from "./homebase-assignment";
import { ensureRoute } from "./routes";

export type HomebaseShiftInput = {
  shiftId: string;
  userId: string;
  jobId: string;
  employeeDisplayName: string;
  scheduleDate: string;
  startTimestamp: string;
  endTimestamp: string;
  roleName: string;
  note?: string | null;
  publishedStatus: string;
};

export type HomebaseUserMappingInput = {
  userId: string;
  teamMemberId: number | null;
  displayName?: string | null;
};

export type HomebaseJobMappingInput = {
  jobId: string;
  routeNumber?: string | null;
  displayName?: string | null;
  assignmentType?: string | null;
};

function required(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

export async function upsertHomebaseUserMapping(input: HomebaseUserMappingInput, database: Database = getDb()) {
  const homebaseUserId = required(input.userId, "Homebase user ID");
  const now = new Date().toISOString();
  const [mapping] = await database.insert(homebaseUserMappings).values({
    homebaseUserId,
    teamMemberId: input.teamMemberId,
    displayName: input.displayName?.trim() || null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: homebaseUserMappings.homebaseUserId,
    set: { teamMemberId: input.teamMemberId, displayName: input.displayName?.trim() || null, updatedAt: now },
  }).returning();
  return mapping;
}

export async function upsertHomebaseJobMapping(input: HomebaseJobMappingInput, database: Database = getDb()) {
  const homebaseJobId = required(input.jobId, "Homebase job ID");
  const route = input.routeNumber?.trim() ? await ensureRoute(input.routeNumber, database) : null;
  const now = new Date().toISOString();
  const values = {
    routeId: route?.id || null,
    displayName: input.displayName?.trim() || null,
    assignmentType: input.assignmentType?.trim() || null,
    updatedAt: now,
  };
  const [mapping] = await database.insert(homebaseJobMappings).values({ homebaseJobId, ...values })
    .onConflictDoUpdate({ target: homebaseJobMappings.homebaseJobId, set: values }).returning();
  return mapping;
}

export async function upsertHomebaseShift(input: HomebaseShiftInput, database: Database = getDb()) {
  const shiftId = required(input.shiftId, "Homebase shift ID");
  const userId = required(input.userId, "Homebase user ID");
  const jobId = required(input.jobId, "Homebase job ID");
  const roleName = required(input.roleName, "Homebase assignment");
  const parsed = parseHomebaseAssignment(roleName);
  const [userMapping] = await database.select().from(homebaseUserMappings)
    .where(eq(homebaseUserMappings.homebaseUserId, userId)).limit(1);
  const [jobMapping] = await database.select().from(homebaseJobMappings)
    .where(eq(homebaseJobMappings.homebaseJobId, jobId)).limit(1);
  const parsedRoute = parsed.routeNumber ? await ensureRoute(parsed.routeNumber, database) : null;
  const now = new Date().toISOString();
  const assignmentType = parsed.assignmentType === "other" && jobMapping?.assignmentType
    ? jobMapping.assignmentType
    : parsed.specialType || parsed.assignmentType;

  const values = {
    homebaseShiftId: shiftId,
    homebaseUserId: userId,
    homebaseJobId: jobId,
    teamMemberId: userMapping?.teamMemberId || null,
    employeeDisplayName: required(input.employeeDisplayName, "Employee display name"),
    scheduleDate: required(input.scheduleDate, "Schedule date"),
    startTimestamp: required(input.startTimestamp, "Start timestamp"),
    endTimestamp: required(input.endTimestamp, "End timestamp"),
    rawAssignment: roleName,
    rawNote: input.note?.trim() || null,
    publishedStatus: required(input.publishedStatus, "Published status"),
    routeId: parsedRoute?.id || jobMapping?.routeId || null,
    assignmentType,
    updatedAt: now,
  };

  const [shift] = await database.insert(homebaseShifts).values({ ...values, importedAt: now })
    .onConflictDoUpdate({
      target: homebaseShifts.homebaseShiftId,
      set: values,
    }).returning();
  return shift;
}

export async function listHomebaseAssignments(scheduleDate: string, database: Database = getDb()) {
  return database.select({
    id: homebaseShifts.id,
    shiftId: homebaseShifts.homebaseShiftId,
    userId: homebaseShifts.homebaseUserId,
    jobId: homebaseShifts.homebaseJobId,
    employeeDisplayName: homebaseShifts.employeeDisplayName,
    teamMemberId: homebaseShifts.teamMemberId,
    teamMemberName: teamMembers.name,
    scheduleDate: homebaseShifts.scheduleDate,
    startTimestamp: homebaseShifts.startTimestamp,
    endTimestamp: homebaseShifts.endTimestamp,
    rawAssignment: homebaseShifts.rawAssignment,
    rawNote: homebaseShifts.rawNote,
    publishedStatus: homebaseShifts.publishedStatus,
    assignmentType: homebaseShifts.assignmentType,
    routeId: homebaseShifts.routeId,
    routeNumber: routes.routeNumber,
    updatedAt: homebaseShifts.updatedAt,
  }).from(homebaseShifts)
    .leftJoin(teamMembers, eq(homebaseShifts.teamMemberId, teamMembers.id))
    .leftJoin(routes, eq(homebaseShifts.routeId, routes.id))
    .where(eq(homebaseShifts.scheduleDate, scheduleDate))
    .orderBy(asc(homebaseShifts.startTimestamp), asc(homebaseShifts.employeeDisplayName));
}

export function tomorrowInTimeZone(timeZone = "America/Chicago", now = new Date()) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(tomorrow);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
