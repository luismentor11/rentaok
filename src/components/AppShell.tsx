"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [officeName, setOfficeName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!user) {
      setTenantId(null);
      setTenantLoading(false);
      return;
    }
    setTenantLoading(true);

    const resolveTenant = async () => {
      try {
        const tokenResult = await user.getIdTokenResult();
        if (!active) return;
        const claimTenantId =
          typeof tokenResult.claims?.tenantId === "string"
            ? tokenResult.claims.tenantId
            : null;
        setTenantId(claimTenantId);
        if (claimTenantId) {
          localStorage.setItem("tenantId", claimTenantId);
          localStorage.setItem("rentaok:tenantId", claimTenantId);
        }
      } finally {
        if (!active) return;
        setTenantLoading(false);
      }
    };

    resolveTenant();

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!tenantId) {
      setOfficeName(null);
      return;
    }
    let active = true;
    const loadOfficeName = async () => {
      try {
        const settingsRef = doc(db, "tenants", tenantId, "settings", "general");
        const snap = await getDoc(settingsRef);
        if (!active) return;
        const rawName =
          typeof snap.data()?.office?.officeName === "string"
            ? snap.data()?.office?.officeName
            : "";
        const nextName = rawName.trim();
        setOfficeName(nextName ? nextName : null);
      } catch {
        if (!active) return;
        setOfficeName(null);
      }
    };

    loadOfficeName();
    return () => {
      active = false;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantLoading && user && !tenantId) {
      setOfficeName(null);
    }
  }, [tenantLoading, user, tenantId]);

  useEffect(() => {
    if (!tenantLoading && user && !tenantId && !pathname.startsWith("/tenants")) {
      router.replace("/tenants");
    }
  }, [tenantLoading, user, tenantId, pathname, router]);

  const navLinkClass = (href: string) => {
    const isActive = pathname === href;
    return [
      "flex items-center gap-3 rounded-lg px-3 py-2 transition",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      isActive
        ? "bg-surface-alt text-text shadow-sm"
        : "text-text-muted hover:bg-surface-alt hover:text-text",
    ].join(" ");
  };

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 h-screen w-64 border-r border-border bg-surface px-5 py-6">
          <Link href="/dashboard" className="inline-flex items-center gap-2 py-0.5">
            <img
              src="/brand/logo.png"
              alt="RentaOK"
              className="h-32 w-auto"
            />
          </Link>
          <div className="mt-6 space-y-2 text-sm font-medium text-text-muted">
            <Link
              href="/dashboard"
              className={navLinkClass("/dashboard")}
              aria-current={pathname === "/dashboard" ? "page" : undefined}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 10.5 12 3l9 7.5" />
                <path d="M5 10v9h5v-5h4v5h5v-9" />
              </svg>
              Dashboard
            </Link>
            <Link
              href="/contracts"
              className={navLinkClass("/contracts")}
              aria-current={pathname === "/contracts" ? "page" : undefined}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M9 13h6" />
                <path d="M9 17h6" />
              </svg>
              Contratos
            </Link>
            <Link
              href="/canones"
              className={navLinkClass("/canones")}
              aria-current={pathname === "/canones" ? "page" : undefined}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              Canon/Mes
            </Link>
            <Link
              href="/pagos"
              className={navLinkClass("/pagos")}
              aria-current={pathname === "/pagos" ? "page" : undefined}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 10h18" />
                <path d="M7 15h3" />
              </svg>
              Pagos
            </Link>
            <Link
              href="/settings"
              className={navLinkClass("/settings")}
              aria-current={pathname === "/settings" ? "page" : undefined}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 6h16" />
                <path d="M4 12h16" />
                <path d="M4 18h16" />
                <circle cx="8" cy="6" r="2" />
                <circle cx="16" cy="12" r="2" />
                <circle cx="10" cy="18" r="2" />
              </svg>
              Configuracion
            </Link>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
            <div className="flex items-center justify-between px-6 py-4 text-sm text-text-muted">
              <span>
                {officeName
                  ? `Panel Operativo \u2014 ${officeName}`
                  : "Panel Operativo"}
              </span>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                  {typeof window !== "undefined" &&
                  (window.location.hostname.includes("localhost") ||
                    window.location.hostname.includes("127.0.0.1"))
                    ? "DEV"
                    : "PROD"}
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-alt text-xs font-semibold text-text">
                  {(officeName ?? "PO")
                    .split(" ")
                    .filter(Boolean)
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="hidden text-xs text-text-muted md:block">
                  {user?.email ?? ""}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-alt"
                >
                  Cerrar sesion
                </button>
              </div>
            </div>
          </header>
          <main className="flex-1 px-6 py-8 pb-28">
            {tenantLoading && user && !tenantId && (
              <div className="mb-6 rounded-lg border border-zinc-200 bg-surface px-4 py-3 text-sm text-zinc-600">
                Cargando...
              </div>
            )}
            {!tenantLoading && user && !tenantId && (
              <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div>Necesitamos validar tu espacio antes de continuar.</div>
                <Link href="/debug" className="mt-2 inline-flex text-amber-800 underline">
                  Abrir ayuda
                </Link>
              </div>
            )}
            {children}
          </main>
        </div>
      </div>
      <footer className="fixed bottom-0 left-0 right-0 border-t border-border bg-surface/95 px-6 py-3 text-xs text-text-muted backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-1">
          <div>RentaOK by Mentora</div>
          <div>2025 Mentora. Todos los derechos reservados.</div>
          <div>
            RentaOK es una herramienta de gestion administrativa. No realiza
            cobranzas legales ni garantiza el pago. La informacion y los
            registros generados tienen fines operativos y documentales.
          </div>
        </div>
      </footer>
    </div>
  );
}


