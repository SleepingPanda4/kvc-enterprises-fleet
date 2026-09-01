import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const vehicles = sqliteTable("vehicles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: text("number").notNull().unique(),
  routeNumber: text("route_number"),
  makeModel: text("make_model").notNull(),
  year: integer("year"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("vehicles_route_number_unique")
    .on(table.routeNumber)
    .where(sql`${table.routeNumber} IS NOT NULL`),
]);

export const vehicleModels = sqliteTable("vehicle_models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const routeSettings = sqliteTable("route_settings", {
  routeNumber: text("route_number").primaryKey(),
  color: text("color").notNull().default("#087A46"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const routes = sqliteTable("routes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  routeNumber: text("route_number").notNull(),
  displayName: text("display_name"),
  description: text("description"),
  color: text("color").notNull().default("#087A46"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("routes_route_number_unique").on(table.routeNumber)]);

export const issues = sqliteTable("issues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  notes: text("notes").notNull(),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  serviceScheduled: integer("service_scheduled", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  reportedByUserId: integer("reported_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reportedByName: text("reported_by_name"),
});

export const issueAttachments = sqliteTable("issue_attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id").notNull(),
  issueId: integer("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
  originalFilename: text("original_filename").notNull(),
  storedFilename: text("stored_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  context: text("context", { enum: ["report", "resolution", "update"] }).notNull().default("report"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("issue_attachments_issue_idx").on(table.issueId), uniqueIndex("issue_attachments_public_id_unique").on(table.publicId)]);

export const teamMembers = sqliteTable("team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nickname: text("nickname"),
  phoneNumber: text("phone_number").notNull(),
  email: text("email"),
  availabilityDays: text("availability_days").notNull().default("[]"),
  regularRoute: text("regular_route"),
  saturdayRoute: text("saturday_route"),
  sundayRoute: text("sunday_route"),
  dswDriverName: text("dsw_driver_name"),
  role: text("role", { enum: ["Team Member", "Fleet Manager"] }).notNull().default("Team Member"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("team_members_dsw_driver_name_unique")
    .on(table.dswDriverName)
    .where(sql`${table.dswDriverName} IS NOT NULL`),
]);

export const homebaseUserMappings = sqliteTable("homebase_user_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  homebaseUserId: text("homebase_user_id").notNull(),
  teamMemberId: integer("team_member_id").references(() => teamMembers.id, { onDelete: "set null" }),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("homebase_user_mappings_user_unique").on(table.homebaseUserId),
  index("homebase_user_mappings_team_member_idx").on(table.teamMemberId),
]);

export const homebaseJobMappings = sqliteTable("homebase_job_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  homebaseJobId: text("homebase_job_id").notNull(),
  routeId: integer("route_id").references(() => routes.id, { onDelete: "set null" }),
  displayName: text("display_name"),
  assignmentType: text("assignment_type"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("homebase_job_mappings_job_unique").on(table.homebaseJobId),
  index("homebase_job_mappings_route_idx").on(table.routeId),
]);

export const homebaseShifts = sqliteTable("homebase_shifts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  homebaseShiftId: text("homebase_shift_id").notNull(),
  homebaseUserId: text("homebase_user_id").notNull(),
  homebaseJobId: text("homebase_job_id").notNull(),
  teamMemberId: integer("team_member_id").references(() => teamMembers.id, { onDelete: "set null" }),
  employeeDisplayName: text("employee_display_name").notNull(),
  employeeFirstName: text("employee_first_name"),
  employeeLastName: text("employee_last_name"),
  scheduleDate: text("schedule_date").notNull(),
  startTimestamp: text("start_timestamp").notNull(),
  endTimestamp: text("end_timestamp").notNull(),
  rawAssignment: text("raw_assignment").notNull(),
  rawNote: text("raw_note"),
  publishedStatus: text("published_status").notNull(),
  routeId: integer("route_id").references(() => routes.id, { onDelete: "set null" }),
  assignmentType: text("assignment_type").notNull(),
  confidence: text("confidence"),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("homebase_shifts_shift_unique").on(table.homebaseShiftId),
  index("homebase_shifts_schedule_date_idx").on(table.scheduleDate),
  index("homebase_shifts_user_idx").on(table.homebaseUserId),
  index("homebase_shifts_team_member_idx").on(table.teamMemberId),
  index("homebase_shifts_route_idx").on(table.routeId),
]);

export const dailyAssignments = sqliteTable("daily_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  operationalDate: text("operational_date").notNull(),
  teamMemberId: integer("team_member_id").notNull().references(() => teamMembers.id, { onDelete: "cascade" }),
  destinationType: text("destination_type", { enum: ["route", "special", "unassigned"] }).notNull(),
  routeId: integer("route_id").references(() => routes.id, { onDelete: "set null" }),
  specialAssignment: text("special_assignment"),
  source: text("source", { enum: ["homebase", "manual"] }).notNull().default("homebase"),
  homebaseShiftId: integer("homebase_shift_id").references(() => homebaseShifts.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("daily_assignments_date_member_unique").on(table.operationalDate, table.teamMemberId),
  uniqueIndex("daily_assignments_date_route_unique")
    .on(table.operationalDate, table.routeId)
    .where(sql`${table.destinationType} = 'route' AND ${table.routeId} IS NOT NULL`),
  index("daily_assignments_date_type_idx").on(table.operationalDate, table.destinationType),
  index("daily_assignments_homebase_shift_idx").on(table.homebaseShiftId),
]);

export const droSnapshots = sqliteTable("dro_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  operationalDate: text("operational_date").notNull(),
  capturedAt: text("captured_at").notNull(),
  sourceTimestamp: text("source_timestamp"),
  stationId: text("station_id").notNull(),
  serviceAreaId: text("service_area_id").notNull(),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("dro_snapshots_operational_date_idx").on(table.operationalDate),
  index("dro_snapshots_captured_at_idx").on(table.capturedAt),
  index("dro_snapshots_operational_date_captured_at_idx").on(table.operationalDate, table.capturedAt),
]);

export const droRouteRows = sqliteTable("dro_route_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  snapshotId: integer("snapshot_id").notNull().references(() => droSnapshots.id, { onDelete: "cascade" }),
  routeId: integer("route_id").references(() => routes.id, { onDelete: "set null" }),
  routeNumber: text("route_number"),
  rawWaNumber: text("raw_wa_number").notNull(),
  displayWaNumber: text("display_wa_number"),
  deliveryCube: real("delivery_cube").notNull().default(0),
  pickupCube: real("pickup_cube").notNull().default(0),
  combinationCube: real("combination_cube").notNull().default(0),
  usedCapacity: real("used_capacity").notNull().default(0),
  vehicleCapacity: real("vehicle_capacity").notNull().default(0),
  deliveryPackages: integer("delivery_packages").notNull().default(0),
  pickupPackages: integer("pickup_packages").notNull().default(0),
  combinationPackages: integer("combination_packages").notNull().default(0),
  totalPackages: integer("total_packages").notNull().default(0),
  deliveryStops: integer("delivery_stops").notNull().default(0),
  pickupStops: integer("pickup_stops").notNull().default(0),
  combinationStops: integer("combination_stops").notNull().default(0),
  totalStops: integer("total_stops").notNull().default(0),
  routeType: text("route_type"),
  routeTime: text("route_time"),
  distance: real("distance"),
  warning: integer("warning", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("dro_route_rows_snapshot_wa_unique").on(table.snapshotId, table.rawWaNumber),
  index("dro_route_rows_snapshot_idx").on(table.snapshotId),
  index("dro_route_rows_route_idx").on(table.routeId),
]);

export const scheduleEntries = sqliteTable("schedule_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamMemberId: integer("team_member_id").notNull().references(() => teamMembers.id, { onDelete: "cascade" }),
  weekStart: text("week_start").notNull(),
  day: text("day").notNull(),
  routeNumber: text("route_number"),
  startTime: text("start_time").notNull().default("08:00"),
  endTime: text("end_time").notNull().default("17:00"),
  notes: text("notes"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("schedule_entries_member_week_day_unique")
    .on(table.teamMemberId, table.weekStart, table.day),
]);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamMemberId: integer("team_member_id").references(() => teamMembers.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  nickname: text("nickname"),
  fedexId: text("fedex_id"),
  profileImageId: text("profile_image_id"),
  email: text("email").notNull().unique(),
  phoneNumber: text("phone_number").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["Team Member", "Fleet Manager", "FLEET_OWNER"] }).notNull().default("Team Member"),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("users_team_member_unique").on(table.teamMemberId), uniqueIndex("users_fedex_id_unique").on(table.fedexId)]);

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text("last_used_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const siteSettings = sqliteTable("site_settings", { id: integer("id").primaryKey(), companyName: text("company_name").notNull().default("KVC Enterprises"), identityMode: text("identity_mode").notNull().default("name"), primaryColor: text("primary_color").notNull().default("#087A46"), sidebarColor: text("sidebar_color").notNull().default("#102A20"), accentColor: text("accent_color").notNull().default("#F2C14E"), logoImageId: text("logo_image_id"), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedByUserId: integer("updated_by_user_id").references(() => users.id, { onDelete: "set null" }) });
export const storedImages = sqliteTable("stored_images", { id: text("id").primaryKey(), kind: text("kind").notNull(), storedFilename: text("stored_filename").notNull(), mimeType: text("mime_type").notNull(), sizeBytes: integer("size_bytes").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`) });

export const integrationCredentials = sqliteTable("integration_credentials", {
  integration: text("integration", { enum: ["MGBA", "HOMEBASE"] }).primaryKey(),
  username: text("username").notNull().default(""),
  passwordCiphertext: text("password_ciphertext"),
  passwordIv: text("password_iv"),
  passwordTag: text("password_tag"),
  encryptionVersion: text("encryption_version"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

export const integrationCredentialAudit = sqliteTable("integration_credential_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  integration: text("integration", { enum: ["MGBA", "HOMEBASE"] }).notNull(),
  action: text("action").notNull(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("integration_credential_audit_integration_idx").on(table.integration)]);

export const mgbaDswSnapshots = sqliteTable("mgba_dsw_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  operationalDate: text("operational_date").notNull(),
  dswDate: text("dsw_date").notNull(),
  capturedAt: text("captured_at").notNull(),
  source: text("source").notNull(),
  routeCount: integer("route_count").notNull(),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("mgba_dsw_snapshots_operational_date_idx").on(table.operationalDate),
  index("mgba_dsw_snapshots_captured_at_idx").on(table.capturedAt),
  index("mgba_dsw_snapshots_operational_date_captured_at_idx").on(table.operationalDate, table.capturedAt),
]);

export const mgbaDswRouteRows = sqliteTable("mgba_dsw_route_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  snapshotId: integer("snapshot_id").notNull().references(() => mgbaDswSnapshots.id, { onDelete: "cascade" }),
  routeId: integer("route_id").references(() => routes.id, { onDelete: "set null" }),
  serviceArea: text("service_area"),
  waName: text("wa_name"),
  vehicleNumber: text("vehicle_number"),
  driverName: text("driver_name").notNull(),
  routeNumber: text("route_number"),
  rawRoute: text("raw_route"),
  dst: text("dst"),
  vscanPkgs: integer("vscan_pkgs"),
  delStops: integer("del_stops"),
  puStops: integer("pu_stops"),
  diff: integer("diff"),
  actDelStops: integer("act_del_stops"),
  actDelPkgs: integer("act_del_pkgs"),
  actPuStops: integer("act_pu_stops"),
  actPuPkgs: integer("act_pu_pkgs"),
  ilsPercent: real("ils_percent"),
  nextAvailOnDuty: text("next_avail_on_duty"),
  allStatusCodePkgs: integer("all_status_code_pkgs"),
  driverOrder: integer("driver_order").notNull().default(0),
  statusPackagesState: text("status_packages_state", { enum: ["not_applicable", "captured", "incomplete", "failed"] }).notNull().default("not_applicable"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  index("mgba_dsw_route_rows_snapshot_idx").on(table.snapshotId),
  index("mgba_dsw_route_rows_route_idx").on(table.routeId),
]);

export const authTokens = sqliteTable("auth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["verify", "reset"] }).notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mgbaDswStatusPackages = sqliteTable("mgba_dsw_status_packages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  routeRowId: integer("route_row_id").notNull().references(() => mgbaDswRouteRows.id, { onDelete: "cascade" }),
  packageNumber: integer("package_number").notNull(),
  additionalInfo: text("additional_info"), visionLabel: text("vision_label"), trackingId: text("tracking_id"), destinationAddress: text("destination_address"),
  vehicleNumber: text("vehicle_number"), vsaStatusCode: text("vsa_status_code"), starStatusCode: text("star_status_code"), starScanTime: text("star_scan_time"),
  isGreyedOut: integer("is_greyed_out", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("mgba_dsw_status_packages_route_row_idx").on(table.routeRowId)]);
