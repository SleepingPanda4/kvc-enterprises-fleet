"use client";

import { createContext, useContext, useMemo, useState } from "react";

type Guard = ((proceed: () => void) => void) | null;
const Context = createContext<{ setGuard: (guard: Guard) => void; requestNavigation: (proceed: () => void) => void }>({ setGuard: () => undefined, requestNavigation: proceed => proceed() });

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const [guard, setGuard] = useState<Guard>(null);
  const value = useMemo(() => ({ setGuard, requestNavigation: (proceed: () => void) => guard ? guard(proceed) : proceed() }), [guard]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useUnsavedChangesNavigation() { return useContext(Context); }
