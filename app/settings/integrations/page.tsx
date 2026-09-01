import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../auth/server";
import { isFleetOwner } from "../../auth/roles";
import { IntegrationsSettingsApp } from "./IntegrationsSettingsApp";

export default async function IntegrationsPage() { const requestHeaders = await headers(); const user = await getCurrentUser(new Request("http://localhost/settings/integrations", { headers: requestHeaders })); if (!user) redirect("/"); if (!isFleetOwner(user.role)) redirect("/settings/account"); return <IntegrationsSettingsApp />; }
