import type { Metadata } from "next";
import { VehicleDetail } from "./VehicleDetail";

export const metadata: Metadata = { title: "Vehicle | KVC Enterprises", description: "KVC Enterprises vehicle profile and issue history." };
export default async function Page({ params }: { params: Promise<{id:string}> }) { const { id } = await params; return <VehicleDetail id={id} />; }
