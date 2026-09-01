import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { siteSettings } from "../../../../../db/schema";
import { getCurrentUser } from "../../../../auth/server";
import { isFleetOwner } from "../../../../auth/roles";
import { removeStoredImage, saveStoredImage } from "../../../../../services/stored-images";

async function owner(request: Request) {
  const user = await getCurrentUser(request);
  return user && isFleetOwner(user.role) ? user : null;
}

export async function POST(request: Request) {
  const user = await owner(request);
  if (!user) return Response.json({ error: "Fleet Owner access is required." }, { status: 403 });
  try {
    const file = (await request.formData()).get("image");
    if (!(file instanceof File)) return Response.json({ error: "Choose an image." }, { status: 400 });
    const image = await saveStoredImage(file, "branding");
    const db = getDb();
    const [existing] = await db.select({ logoImageId: siteSettings.logoImageId }).from(siteSettings).where(eq(siteSettings.id, 1)).limit(1);
    await db.insert(siteSettings).values({ id: 1, logoImageId: image.id, updatedAt: new Date().toISOString(), updatedByUserId: user.id })
      .onConflictDoUpdate({ target: siteSettings.id, set: { logoImageId: image.id, updatedAt: new Date().toISOString(), updatedByUserId: user.id } });
    await removeStoredImage(existing?.logoImageId || null);
    return Response.json({ logoImageId: image.id });
  } catch {
    return Response.json({ error: "Logo upload was rejected." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await owner(request);
  if (!user) return Response.json({ error: "Fleet Owner access is required." }, { status: 403 });
  const db = getDb();
  const [existing] = await db.select({ logoImageId: siteSettings.logoImageId }).from(siteSettings).where(eq(siteSettings.id, 1)).limit(1);
  await db.insert(siteSettings).values({ id: 1, updatedAt: new Date().toISOString(), updatedByUserId: user.id })
    .onConflictDoUpdate({ target: siteSettings.id, set: { logoImageId: null, updatedAt: new Date().toISOString(), updatedByUserId: user.id } });
  await removeStoredImage(existing?.logoImageId || null);
  return Response.json({ removed: true });
}
