import { and, asc, eq } from "drizzle-orm";
import { getDb, type Database } from "../../db";
import { dailyAssignments, homebaseShifts, routes, teamMembers } from "../../db/schema";

export const PRIMARY_SPECIAL_ASSIGNMENTS = ["BC", "TBD ROUTE", "ON CALL AT HOME"] as const;

export type AssignmentDestination =
  | { type: "route"; routeNumber: string }
  | { type: "special"; specialAssignment: string }
  | { type: "unassigned" };

export type DailyAssignmentMember = {
  teamMemberId: number;
  name: string;
  destination: AssignmentDestination;
  assignmentLabel: string;
  source: "homebase" | "manual";
  homebase: {
    shiftId: string;
    employeeDisplayName: string;
    rawAssignment: string;
    destination: AssignmentDestination;
    startTimestamp: string;
    endTimestamp: string;
  } | null;
};

export type DailyAssignmentBoard = {
  operationalDate: string;
  hasHomebaseData: boolean;
  hasManualChanges: boolean;
  members: DailyAssignmentMember[];
  unmatchedHomebase: Array<{
    shiftId: string;
    homebaseUserId: string;
    employeeDisplayName: string;
    rawAssignment: string;
  }>;
};

let assignmentQueue: Promise<void> = Promise.resolve();

async function withAssignmentLock<T>(work: () => Promise<T>) {
  const previous = assignmentQueue;
  let release: () => void = () => {};
  assignmentQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

export function validOperationalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

export function normalizeSpecialAssignment(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function assignmentLabel(destination: AssignmentDestination) {
  if (destination.type === "route") return destination.routeNumber;
  if (destination.type === "special") return destination.specialAssignment;
  return "Unassigned";
}

function destinationFromRow(row: { destinationType: string; routeNumber: string | null; specialAssignment: string | null }): AssignmentDestination {
  if (row.destinationType === "route" && row.routeNumber) return { type: "route", routeNumber: row.routeNumber };
  if (row.destinationType === "special" && row.specialAssignment) return { type: "special", specialAssignment: row.specialAssignment };
  return { type: "unassigned" };
}

function destinationFromHomebase(row: { routeNumber: string | null; assignmentType: string; rawAssignment: string }): AssignmentDestination {
  if (row.routeNumber && row.assignmentType === "route") return { type: "route", routeNumber: row.routeNumber };
  return { type: "special", specialAssignment: normalizeSpecialAssignment(row.rawAssignment) };
}

async function loadHomebaseRows(operationalDate: string, database: Database) {
  return database.select({
    id: homebaseShifts.id,
    shiftId: homebaseShifts.homebaseShiftId,
    homebaseUserId: homebaseShifts.homebaseUserId,
    teamMemberId: homebaseShifts.teamMemberId,
    employeeDisplayName: homebaseShifts.employeeDisplayName,
    rawAssignment: homebaseShifts.rawAssignment,
    assignmentType: homebaseShifts.assignmentType,
    routeId: homebaseShifts.routeId,
    routeNumber: routes.routeNumber,
    startTimestamp: homebaseShifts.startTimestamp,
    endTimestamp: homebaseShifts.endTimestamp,
  }).from(homebaseShifts)
    .leftJoin(routes, eq(homebaseShifts.routeId, routes.id))
    .where(eq(homebaseShifts.scheduleDate, operationalDate))
    .orderBy(asc(homebaseShifts.startTimestamp), asc(homebaseShifts.id));
}

async function rebuildFromHomebase(operationalDate: string, database: Database) {
  const shifts = await loadHomebaseRows(operationalDate, database);
  await database.delete(dailyAssignments).where(eq(dailyAssignments.operationalDate, operationalDate));

  const claimedMembers = new Set<number>();
  const claimedRoutes = new Set<number>();
  const values: Array<typeof dailyAssignments.$inferInsert> = [];
  for (const shift of shifts) {
    if (!shift.teamMemberId || claimedMembers.has(shift.teamMemberId)) continue;
    claimedMembers.add(shift.teamMemberId);
    const routeAvailable = shift.assignmentType === "route" && shift.routeId && !claimedRoutes.has(shift.routeId);
    if (routeAvailable && shift.routeId) claimedRoutes.add(shift.routeId);
    values.push({
      operationalDate,
      teamMemberId: shift.teamMemberId,
      destinationType: routeAvailable ? "route" : shift.assignmentType === "route" ? "unassigned" : "special",
      routeId: routeAvailable ? shift.routeId : null,
      specialAssignment: routeAvailable || shift.assignmentType === "route" ? null : normalizeSpecialAssignment(shift.rawAssignment),
      source: "homebase",
      homebaseShiftId: shift.id,
      updatedAt: new Date().toISOString(),
    });
  }
  if (values.length) await database.insert(dailyAssignments).values(values);
}

async function ensureDailyAssignmentsUnlocked(operationalDate: string, database: Database) {
  const existing = await database.select({ id: dailyAssignments.id }).from(dailyAssignments)
    .where(eq(dailyAssignments.operationalDate, operationalDate)).limit(1);
  if (existing.length) return;
  const imported = await database.select({ id: homebaseShifts.id }).from(homebaseShifts)
    .where(eq(homebaseShifts.scheduleDate, operationalDate)).limit(1);
  if (imported.length) await rebuildFromHomebase(operationalDate, database);
}

async function getDailyAssignmentBoardUnlocked(operationalDate: string, database: Database): Promise<DailyAssignmentBoard> {
  await ensureDailyAssignmentsUnlocked(operationalDate, database);
  const [roster, currentRows, homebaseRows] = await Promise.all([
    database.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers).orderBy(asc(teamMembers.name)),
    database.select({
      teamMemberId: dailyAssignments.teamMemberId,
      destinationType: dailyAssignments.destinationType,
      routeNumber: routes.routeNumber,
      specialAssignment: dailyAssignments.specialAssignment,
      source: dailyAssignments.source,
      homebaseShiftId: dailyAssignments.homebaseShiftId,
    }).from(dailyAssignments)
      .leftJoin(routes, eq(dailyAssignments.routeId, routes.id))
      .where(eq(dailyAssignments.operationalDate, operationalDate)),
    loadHomebaseRows(operationalDate, database),
  ]);

  const currentByMember = new Map(currentRows.map(row => [row.teamMemberId, row]));
  const homebaseByMember = new Map<number, (typeof homebaseRows)[number]>();
  for (const shift of homebaseRows) {
    if (shift.teamMemberId && !homebaseByMember.has(shift.teamMemberId)) homebaseByMember.set(shift.teamMemberId, shift);
  }

  const members = roster.map(member => {
    const current = currentByMember.get(member.id);
    const original = homebaseByMember.get(member.id);
    const destination = current ? destinationFromRow(current) : { type: "unassigned" } as const;
    const homebaseDestination = original ? destinationFromHomebase(original) : null;
    return {
      teamMemberId: member.id,
      name: member.name,
      destination,
      assignmentLabel: assignmentLabel(destination),
      source: current?.source === "manual" ? "manual" as const : "homebase" as const,
      homebase: original && homebaseDestination ? {
        shiftId: original.shiftId,
        employeeDisplayName: original.employeeDisplayName,
        rawAssignment: original.rawAssignment,
        destination: homebaseDestination,
        startTimestamp: original.startTimestamp,
        endTimestamp: original.endTimestamp,
      } : null,
    };
  });

  return {
    operationalDate,
    hasHomebaseData: homebaseRows.length > 0,
    hasManualChanges: currentRows.some(row => row.source === "manual"),
    members,
    unmatchedHomebase: homebaseRows.filter(row => !row.teamMemberId).map(row => ({
      shiftId: row.shiftId,
      homebaseUserId: row.homebaseUserId,
      employeeDisplayName: row.employeeDisplayName,
      rawAssignment: row.rawAssignment,
    })),
  };
}

export async function getDailyAssignmentBoard(operationalDate: string, database: Database = getDb()) {
  if (!validOperationalDate(operationalDate)) throw new Error("A valid operational date is required.");
  return withAssignmentLock(() => getDailyAssignmentBoardUnlocked(operationalDate, database));
}

async function resolveDestination(destination: AssignmentDestination, database: Database) {
  if (destination.type === "route") {
    const routeNumber = destination.routeNumber.trim();
    const [route] = await database.select({ id: routes.id, routeNumber: routes.routeNumber }).from(routes)
      .where(eq(routes.routeNumber, routeNumber)).limit(1);
    if (!route) throw new Error("Choose a valid route assignment.");
    return { type: "route" as const, routeId: route.id, routeNumber: route.routeNumber, specialAssignment: null };
  }
  if (destination.type === "special") {
    const specialAssignment = normalizeSpecialAssignment(destination.specialAssignment);
    if (!specialAssignment || specialAssignment.length > 100) throw new Error("Choose a valid special assignment.");
    return { type: "special" as const, routeId: null, routeNumber: null, specialAssignment };
  }
  return { type: "unassigned" as const, routeId: null, routeNumber: null, specialAssignment: null };
}

function sameDestination(
  row: { destinationType: string; routeId: number | null; specialAssignment: string | null } | undefined,
  destination: { type: string; routeId: number | null; specialAssignment: string | null },
) {
  if (!row) return destination.type === "unassigned";
  return row.destinationType === destination.type
    && row.routeId === destination.routeId
    && row.specialAssignment === destination.specialAssignment;
}

export async function swapDailyAssignment(input: {
  operationalDate: string;
  destination: AssignmentDestination;
  replacementTeamMemberId: number;
  replacedTeamMemberId?: number | null;
}, database: Database = getDb()) {
  if (!validOperationalDate(input.operationalDate)) throw new Error("Choose a valid operational date.");
  if (!Number.isInteger(input.replacementTeamMemberId) || input.replacementTeamMemberId <= 0) throw new Error("Choose a valid replacement team member.");

  return withAssignmentLock(async () => {
    await ensureDailyAssignmentsUnlocked(input.operationalDate, database);
    const target = await resolveDestination(input.destination, database);
    await database.transaction(async transaction => {
      const tx = transaction as unknown as Database;
      const [replacement] = await tx.select({ id: teamMembers.id }).from(teamMembers)
        .where(eq(teamMembers.id, input.replacementTeamMemberId)).limit(1);
      if (!replacement) throw new Error("That team member is no longer on the roster.");

      const rows = await tx.select().from(dailyAssignments).where(eq(dailyAssignments.operationalDate, input.operationalDate));
      const replacementRow = rows.find(row => row.teamMemberId === input.replacementTeamMemberId);
      let replacedRow = target.type === "route"
        ? rows.find(row => row.destinationType === "route" && row.routeId === target.routeId)
        : input.replacedTeamMemberId
          ? rows.find(row => row.teamMemberId === input.replacedTeamMemberId)
          : undefined;

      if (target.type !== "route" && input.replacedTeamMemberId) {
        const expected = rows.find(row => row.teamMemberId === input.replacedTeamMemberId);
        if (target.type === "unassigned" && !expected) {
          replacedRow = undefined;
        } else if (!expected || !sameDestination(expected, target)) {
          throw new Error("That assignment changed. Reload and try again.");
        }
      }
      if (replacedRow?.teamMemberId === input.replacementTeamMemberId || sameDestination(replacementRow, target)) return;

      const affectedIds = [input.replacementTeamMemberId, replacedRow?.teamMemberId].filter((id): id is number => Boolean(id));
      for (const teamMemberId of affectedIds) {
        await tx.delete(dailyAssignments).where(and(
          eq(dailyAssignments.operationalDate, input.operationalDate),
          eq(dailyAssignments.teamMemberId, teamMemberId),
        ));
      }

      const now = new Date().toISOString();
      await tx.insert(dailyAssignments).values({
        operationalDate: input.operationalDate,
        teamMemberId: input.replacementTeamMemberId,
        destinationType: target.type,
        routeId: target.routeId,
        specialAssignment: target.specialAssignment,
        source: "manual",
        homebaseShiftId: replacementRow?.homebaseShiftId || null,
        updatedAt: now,
      });

      if (replacedRow) {
        await tx.insert(dailyAssignments).values({
          operationalDate: input.operationalDate,
          teamMemberId: replacedRow.teamMemberId,
          destinationType: replacementRow?.destinationType || "unassigned",
          routeId: replacementRow?.routeId || null,
          specialAssignment: replacementRow?.specialAssignment || null,
          source: "manual",
          homebaseShiftId: replacedRow.homebaseShiftId,
          updatedAt: now,
        });
      }
    });
    return getDailyAssignmentBoardUnlocked(input.operationalDate, database);
  });
}

export async function resetDailyAssignmentsToHomebase(operationalDate: string, database: Database = getDb()) {
  if (!validOperationalDate(operationalDate)) throw new Error("Choose a valid operational date.");
  return withAssignmentLock(async () => {
    await database.transaction(async transaction => rebuildFromHomebase(operationalDate, transaction as unknown as Database));
    return getDailyAssignmentBoardUnlocked(operationalDate, database);
  });
}

export async function restoreMemberToHomebase(operationalDate: string, teamMemberId: number, database: Database = getDb()) {
  const board = await getDailyAssignmentBoard(operationalDate, database);
  const member = board.members.find(item => item.teamMemberId === teamMemberId);
  if (!member) throw new Error("That team member is no longer on the roster.");
  if (!member.homebase) throw new Error("That team member has no Homebase assignment for this date.");
  return swapDailyAssignment({
    operationalDate,
    destination: member.homebase.destination,
    replacementTeamMemberId: teamMemberId,
  }, database);
}

export async function refreshHomebaseBackedAssignments(operationalDate: string, database: Database = getDb()) {
  return withAssignmentLock(async () => {
    const manual = await database.select({ id: dailyAssignments.id }).from(dailyAssignments)
      .where(and(eq(dailyAssignments.operationalDate, operationalDate), eq(dailyAssignments.source, "manual"))).limit(1);
    if (!manual.length) {
      await database.transaction(async transaction => rebuildFromHomebase(operationalDate, transaction as unknown as Database));
    }
  });
}
