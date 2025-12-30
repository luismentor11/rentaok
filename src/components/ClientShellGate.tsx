"use client";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";

export function ClientShellGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <>{children}</>;
  }

  if (!user) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}
