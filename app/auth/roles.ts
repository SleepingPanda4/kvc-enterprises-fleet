export type UserRole = "Team Member" | "Fleet Manager" | "FLEET_OWNER";

export function canManageFleet(role: UserRole | string | null | undefined) {
  return role === "Fleet Manager" || role === "FLEET_OWNER";
}

export function isFleetOwner(role: UserRole | string | null | undefined) {
  return role === "FLEET_OWNER";
}

export function roleLabel(role: UserRole | string | null | undefined) {
  return role === "FLEET_OWNER" ? "Fleet Owner" : role || "Team Member";
}
