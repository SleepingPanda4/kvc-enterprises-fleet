import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "../../../db";
import { vehicles } from "../../../db/schema";
import { VehicleDetail } from "./VehicleDetail";

export const metadata: Metadata = { title: "Vehicle | KVC Enterprises", description: "KVC Enterprises vehicle profile and issue history." };
export default async function Page({ params }: { params: Promise<{id:string}> }) {
  const { id } = await params;
  const db = getDb();
  const [numberMatch] = await db.select({ number: vehicles.number }).from(vehicles).where(eq(vehicles.number, id)).limit(1);
  if (numberMatch) return <VehicleDetail id={id} />;
  if (/^\d+$/.test(id)) {
    const [legacyMatch] = await db.select({ number: vehicles.number }).from(vehicles).where(eq(vehicles.id, Number(id))).limit(1);
    if (legacyMatch) redirect(`/vehicles/${encodeURIComponent(legacyMatch.number)}`);
  }
  notFound();
}
