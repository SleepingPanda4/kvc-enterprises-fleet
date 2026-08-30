import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthGate } from "./auth/AuthGate";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  const title = "KVC Enterprises | Fleet Operations";
  const description = "Vehicle assignments, maintenance records, and issue tracking for the KVC Enterprises fleet.";
  return { title, description, openGraph:{ title, description, images:[image] }, twitter:{ card:"summary_large_image", title, description, images:[image] } };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AuthGate>{children}</AuthGate></body></html>;
}
