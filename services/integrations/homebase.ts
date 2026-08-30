import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, type Database } from "../../db";
import { homebaseJobMappings, homebaseShifts, homebaseUserMappings, routes, teamMembers } from "../../db/schema";
import { parseHomebaseAssignment } from "./homebase-assignment";
import { ensureRoute } from "./routes";
import { refreshHomebaseBackedAssignments, validOperationalDate } from "./daily-assignments";

export type HomebaseShiftInput = {
  shiftId: string;
  userId: string;
  jobId: string;
  employeeDisplayName: string;
  employeeFirstName?: string | null;
  employeeLastName?: string | null;
  scheduleDate: string;
  startTimestamp: string;
  endTimestamp: string;
  roleName: string;
  note?: string | null;
  publishedStatus: string;
  confidence?: string | null;
};

export type HomebaseCollectedShiftInput = {
  homebaseShiftId: string;
  homebaseUserId: string;
  homebaseJobId?: string | null;
  date: string;
  employee: string;
  firstName?: string | null;
  lastName?: string | null;
  startAt: string;
  endAt: string;
  assignment: string;
  route?: string | null;
  type?: string | null;
  confidence?: string | null;
  note?: string | null;
  publishedStatus?: string | null;
};

export type HomebaseScheduleInput = {
  rangeStart: string;
  rangeEnd: string;
  collectedAt: string;
  shifts: HomebaseCollectedShiftInput[];
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
    employeeFirstName: input.employeeFirstName?.trim() || null,
    employeeLastName: input.employeeLastName?.trim() || null,
    scheduleDate: required(input.scheduleDate, "Schedule date"),
    startTimestamp: required(input.startTimestamp, "Start timestamp"),
    endTimestamp: required(input.endTimestamp, "End timestamp"),
    rawAssignment: roleName,
    rawNote: input.note?.trim() || null,
    publishedStatus: required(input.publishedStatus, "Published status"),
    routeId: parsedRoute?.id || jobMapping?.routeId || null,
    assignmentType,
    confidence: input.confidence?.trim() || null,
    updatedAt: now,
  };

  const [shift] = await database.insert(homebaseShifts).values({ ...values, importedAt: now })
    .onConflictDoUpdate({
      target: homebaseShifts.homebaseShiftId,
      set: values,
    }).returning();
  return shift;
}

function normalizedPersonName(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function comparableShift(row: {
  homebaseUserId: string;
  homebaseJobId: string;
  teamMemberId: number | null;
  employeeDisplayName: string;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  scheduleDate: string;
  startTimestamp: string;
  endTimestamp: string;
  rawAssignment: string;
  rawNote: string | null;
  publishedStatus: string;
  routeId: number | null;
  assignmentType: string;
  confidence: string | null;
}) {
  return JSON.stringify({
    homebaseUserId: row.homebaseUserId,
    homebaseJobId: row.homebaseJobId,
    teamMemberId: row.teamMemberId,
    employeeDisplayName: row.employeeDisplayName,
    employeeFirstName: row.employeeFirstName,
    employeeLastName: row.employeeLastName,
    scheduleDate: row.scheduleDate,
    startTimestamp: row.startTimestamp,
    endTimestamp: row.endTimestamp,
    rawAssignment: row.rawAssignment,
    rawNote: row.rawNote,
    publishedStatus: row.publishedStatus,
    routeId: row.routeId,
    assignmentType: row.assignmentType,
    confidence: row.confidence,
  });
}

export async function ingestHomebaseSchedule(input: HomebaseScheduleInput, database: Database = getDb()) {
  if (!validOperationalDate(input.rangeStart) || !validOperationalDate(input.rangeEnd) || input.rangeStart > input.rangeEnd) {
    throw new Error("Choose a valid Homebase schedule range.");
  }

  const roster = await database.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers);
  const rosterByName = new Map<string, number[]>();
  for (const member of roster) {
    const normalized = normalizedPersonName(member.name);
    rosterByName.set(normalized, [...(rosterByName.get(normalized) || []), member.id]);
  }
  const userIds = [...new Set(input.shifts.map(shift => shift.homebaseUserId.trim()))];
  const existingMappings = userIds.length
    ? await database.select().from(homebaseUserMappings).where(inArray(homebaseUserMappings.homebaseUserId, userIds))
    : [];
  const mappingByUser = new Map(existingMappings.map(mapping => [mapping.homebaseUserId, mapping]));

  for (const shift of input.shifts) {
    const userId = required(shift.homebaseUserId, "Homebase user ID");
    const existing = mappingByUser.get(userId);
    const matches = rosterByName.get(normalizedPersonName(shift.employee)) || [];
    const teamMemberId = existing?.teamMemberId || (matches.length === 1 ? matches[0] : null);
    const mapping = await upsertHomebaseUserMapping({ userId, teamMemberId, displayName: shift.employee }, database);
    mappingByUser.set(userId, mapping);
  }

  const prepared = [] as Array<{
    homebaseShiftId: string;
    homebaseUserId: string;
    homebaseJobId: string;
    teamMemberId: number | null;
    employeeDisplayName: string;
    employeeFirstName: string | null;
    employeeLastName: string | null;
    scheduleDate: string;
    startTimestamp: string;
    endTimestamp: string;
    rawAssignment: string;
    rawNote: string | null;
    publishedStatus: string;
    routeId: number | null;
    assignmentType: string;
    confidence: string | null;
  }>;
  for (const shift of input.shifts) {
    const assignment = required(shift.assignment, "Homebase assignment");
    const parsed = parseHomebaseAssignment(assignment);
    const parsedRouteNumber = parsed.routeNumber || (shift.type?.trim().toLowerCase() === "route" ? shift.route?.trim() || null : null);
    const route = parsedRouteNumber ? await ensureRoute(parsedRouteNumber, database) : null;
    const mapping = mappingByUser.get(shift.homebaseUserId.trim());
    prepared.push({
      homebaseShiftId: required(shift.homebaseShiftId, "Homebase shift ID"),
      homebaseUserId: required(shift.homebaseUserId, "Homebase user ID"),
      homebaseJobId: shift.homebaseJobId?.trim() || `assignment:${assignment.toUpperCase()}`,
      teamMemberId: mapping?.teamMemberId || null,
      employeeDisplayName: required(shift.employee, "Employee display name"),
      employeeFirstName: shift.firstName?.trim() || null,
      employeeLastName: shift.lastName?.trim() || null,
      scheduleDate: required(shift.date, "Schedule date"),
      startTimestamp: required(shift.startAt, "Start timestamp"),
      endTimestamp: required(shift.endAt, "End timestamp"),
      rawAssignment: assignment,
      rawNote: shift.note?.trim() || null,
      publishedStatus: shift.publishedStatus?.trim() || "scheduled",
      routeId: route?.id || null,
      assignmentType: route ? "route" : parsed.specialType || shift.type?.trim().toLowerCase() === "special" ? "special" : parsed.assignmentType,
      confidence: shift.confidence?.trim() || null,
    });
  }

  if (prepared.some(shift => !validOperationalDate(shift.scheduleDate) || shift.scheduleDate < input.rangeStart || shift.scheduleDate > input.rangeEnd)) {
    throw new Error("Every Homebase shift date must be inside the collected range.");
  }

  const shiftIds = prepared.map(shift => shift.homebaseShiftId);
  const existingShifts = await database.select().from(homebaseShifts).where(and(
    gte(homebaseShifts.scheduleDate, input.rangeStart),
    lte(homebaseShifts.scheduleDate, input.rangeEnd),
  ));
  const existingById = new Map(existingShifts.map(shift => [shift.homebaseShiftId, shift]));
  const incomingIds = new Set(shiftIds);
  const removedShifts = existingShifts.filter(shift => !incomingIds.has(shift.homebaseShiftId));
  let imported = 0;
  let updated = 0;
  let unchanged = 0;

  await database.transaction(async transaction => {
    const now = new Date().toISOString();
    for (const removedShift of removedShifts) {
      await transaction.delete(homebaseShifts).where(eq(homebaseShifts.id, removedShift.id));
    }
    for (const shift of prepared) {
      const existing = existingById.get(shift.homebaseShiftId);
      const existingComparable = existing ? comparableShift({
        homebaseUserId: existing.homebaseUserId,
        homebaseJobId: existing.homebaseJobId,
        teamMemberId: existing.teamMemberId,
        employeeDisplayName: existing.employeeDisplayName,
        employeeFirstName: existing.employeeFirstName,
        employeeLastName: existing.employeeLastName,
        scheduleDate: existing.scheduleDate,
        startTimestamp: existing.startTimestamp,
        endTimestamp: existing.endTimestamp,
        rawAssignment: existing.rawAssignment,
        rawNote: existing.rawNote,
        publishedStatus: existing.publishedStatus,
        routeId: existing.routeId,
        assignmentType: existing.assignmentType,
        confidence: existing.confidence,
      }) : "";
      if (existing && existingComparable === comparableShift(shift)) {
        unchanged += 1;
        continue;
      }
      if (existing) {
        updated += 1;
        await transaction.update(homebaseShifts).set({ ...shift, updatedAt: now })
          .where(eq(homebaseShifts.homebaseShiftId, shift.homebaseShiftId));
      } else {
        imported += 1;
        await transaction.insert(homebaseShifts).values({ ...shift, importedAt: now, updatedAt: now });
      }
    }
  });

  const dates = [...new Set([...prepared.map(shift => shift.scheduleDate), ...removedShifts.map(shift => shift.scheduleDate)])].sort();
  for (const date of dates) await refreshHomebaseBackedAssignments(date, database);
  return {
    imported,
    updated,
    unchanged,
    removed: removedShifts.length,
    dates,
    routeAssignments: prepared.filter(shift => shift.assignmentType === "route").length,
    specialAssignments: prepared.filter(shift => shift.assignmentType !== "route").length,
  };
}

export async function listHomebaseAssignments(scheduleDate: string, database: Database = getDb()) {
  return database.select({
    id: homebaseShifts.id,
    shiftId: homebaseShifts.homebaseShiftId,
    userId: homebaseShifts.homebaseUserId,
    jobId: homebaseShifts.homebaseJobId,
    employeeDisplayName: homebaseShifts.employeeDisplayName,
    employeeFirstName: homebaseShifts.employeeFirstName,
    employeeLastName: homebaseShifts.employeeLastName,
    teamMemberId: homebaseShifts.teamMemberId,
    teamMemberName: teamMembers.name,
    scheduleDate: homebaseShifts.scheduleDate,
    startTimestamp: homebaseShifts.startTimestamp,
    endTimestamp: homebaseShifts.endTimestamp,
    rawAssignment: homebaseShifts.rawAssignment,
    rawNote: homebaseShifts.rawNote,
    publishedStatus: homebaseShifts.publishedStatus,
    assignmentType: homebaseShifts.assignmentType,
    confidence: homebaseShifts.confidence,
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
