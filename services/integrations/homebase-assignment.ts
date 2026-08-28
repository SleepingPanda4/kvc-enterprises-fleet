const specialAssignments = ["BC", "TRAINING", "MISSED", "MISC TASK"] as const;

export type ParsedHomebaseAssignment = {
  routeNumber: string | null;
  assignmentType: "route" | "special" | "other";
  specialType: (typeof specialAssignments)[number] | null;
};

export function parseHomebaseAssignment(value: string): ParsedHomebaseAssignment {
  const raw = value.trim();
  const upper = raw.toUpperCase();
  const leadingRoute = raw.match(/^(\d{3,4})(?:\b|\s)/)?.[1];
  const straightTruckRoute = raw.match(/\bSTRAIGHT\s+TRUCK\s+(\d{3,4})\b/i)?.[1];
  const routeNumber = leadingRoute || straightTruckRoute || null;

  if (routeNumber) return { routeNumber, assignmentType: "route", specialType: null };

  const specialType = specialAssignments.find(type => upper === type || upper.startsWith(`${type} `)) || null;
  if (specialType) return { routeNumber: null, assignmentType: "special", specialType };

  return { routeNumber: null, assignmentType: "other", specialType: null };
}
