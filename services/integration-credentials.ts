import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { integrationCredentialAudit, integrationCredentials } from "../db/schema";
import { encryptIntegrationPassword } from "./integration-credential-crypto";

export type IntegrationName = "MGBA" | "HOMEBASE";
export const integrationNames: IntegrationName[] = ["MGBA", "HOMEBASE"];

export async function integrationCredentialSettings() {
  const rows = await getDb().select().from(integrationCredentials);
  return integrationNames.map(integration => { const row = rows.find(item => item.integration === integration); return { integration, username: row?.username || "", passwordConfigured: Boolean(row?.passwordCiphertext && row.passwordIv && row.passwordTag) }; });
}

export async function updateIntegrationCredential(input: { integration: IntegrationName; username: string; password: string; userId: number }) {
  const db = getDb(); const existing = (await db.select().from(integrationCredentials).where(eq(integrationCredentials.integration, input.integration)).limit(1))[0];
  const encrypted = input.password ? encryptIntegrationPassword(input.password) : null;
  const now = new Date().toISOString();
  const values = { integration: input.integration, username: input.username, ...(encrypted ? { passwordCiphertext: encrypted.ciphertext, passwordIv: encrypted.iv, passwordTag: encrypted.tag, encryptionVersion: encrypted.version } : existing ? { passwordCiphertext: existing.passwordCiphertext, passwordIv: existing.passwordIv, passwordTag: existing.passwordTag, encryptionVersion: existing.encryptionVersion } : {}), updatedAt: now, updatedByUserId: input.userId };
  await db.insert(integrationCredentials).values(values).onConflictDoUpdate({ target: integrationCredentials.integration, set: values });
  await db.insert(integrationCredentialAudit).values({ integration: input.integration, action: "credentials_updated", userId: input.userId, createdAt: now });
  return { integration: input.integration, username: input.username, passwordConfigured: Boolean(encrypted || existing?.passwordCiphertext) };
}
