"use client";

import { GatewayProvider } from "../hooks/GatewayContext";
import AppShell from "./AppShell";
import type { ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <GatewayProvider>
      <AppShell>{children}</AppShell>
    </GatewayProvider>
  );
}
