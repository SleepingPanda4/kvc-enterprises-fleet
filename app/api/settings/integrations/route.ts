import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import { getCurrentUser, verifyPassword } from "../../../auth/server";
import { isFleetOwner } from "../../../auth/roles";
import { integrationCredentialSettings, integrationNames, type IntegrationName, updateIntegrationCredential } from "../../../../services/integration-credentials";

async function owner(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return { error: Response.json({ error: "Authentication required.", code: "AUTH_REQUIRED" }, { status: 401 }) };
  if (!isFleetOwner(user.role)) return { error: Response.json({ error: "Fleet Owner access is required.", code: "AUTH_OWNER_REQUIRED" }, { status: 403 }) };
  return { user };
}

export async function GET(request: Request) {
  const auth = await owner(request); if (auth.error) return auth.error;
  return Response.json({ integrations: await integrationCredentialSettings() });
}

export async function PATCH(request: Request) {
  const auth = await owner(request); if (auth.error) return auth.error;
  try {
    const payload = await request.json() as Record<string, unknown>;
    const integration = String(payload.integration || "") as IntegrationName;
    const username = String(payload.username || "").trim(); const password = String(payload.password || ""); const currentPassword = String(payload.currentPassword || "");
    if (!integrationNames.includes(integration)) return Response.json({ error: "Choose a supported integration.", code: "INTEGRATION_INVALID" }, { status: 400 });
    if (!username) return Response.json({ error: "Login / username is required.", code: "INTEGRATION_USERNAME_REQUIRED" }, { status: 400 });
    const [stored] = await getDb().select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, auth.user.id)).limit(1);
    if (!stored || !verifyPassword(currentPassword, stored.passwordHash)) return Response.json({ error: "Your current Fleet Manager password is incorrect.", code: "INTEGRATION_REAUTH_FAILED" }, { status: 400 });
    const integrationSettings = await updateIntegrationCredential({ integration, username, password, userId: auth.user.id });
    return Response.json({ integration: integrationSettings });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "The integration request was not valid.", code: "INTEGRATION_REQUEST_INVALID" }, { status: 400 });
    const message = error instanceof Error ? error.message : "Integration credentials could not be saved.";
    return Response.json({ error: message === "Integration credential encryption is not configured." ? "Credential encryption has not been configured on this server." : "Integration credentials could not be saved.", code: "INTEGRATION_UPDATE_FAILED" }, { status: 500 });
  }
}
