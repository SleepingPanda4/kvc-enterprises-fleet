"use client";

import { useEffect, useState } from "react";
import { defaultRouteColor } from "./config";

export function useRouteColors() {
  const [colors, setColors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/routes").then(response => response.ok ? response.json() : null).then(body => {
      if (cancelled || !body?.routes) return;
      setColors(Object.fromEntries(body.routes.map((route: { routeNumber: string; color: string }) => [route.routeNumber, route.color])));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return { colors, colorFor: (routeNumber: string | null | undefined) => routeNumber ? colors[routeNumber] || defaultRouteColor : defaultRouteColor };
}
