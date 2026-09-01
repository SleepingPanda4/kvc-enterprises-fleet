"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type SiteBranding = { companyName: string; identityMode: "name" | "logo" | "logo-name"; primaryColor: string; sidebarColor: string; accentColor: string; logoImageId: string | null };
type BrandingContextValue = { branding: SiteBranding | null; setSavedBranding: (branding: SiteBranding) => void };
const BrandingContext = createContext<BrandingContextValue>({ branding: null, setSavedBranding: () => undefined });

export function SiteBrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<SiteBranding | null>(null);
  useEffect(() => { let cancelled = false; void fetch("/api/settings/ui").then(response => response.ok ? response.json() : null).then(body => { if (!cancelled && body?.settings) setBranding(body.settings); }).catch(() => undefined); return () => { cancelled = true; }; }, []);
  const value = useMemo(() => ({ branding, setSavedBranding: setBranding }), [branding]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useSiteBranding() { return useContext(BrandingContext); }
