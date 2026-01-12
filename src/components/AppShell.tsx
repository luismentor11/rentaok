"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import {
  collectionGroup,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectChecked, setAutoDetectChecked] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) {
      setTenantId(null);
      setTenantLoading(false);
      setAutoDetectChecked(false);
      return;
    }
    setTenantLoading(true);
    user
      .getIdTokenResult()
      .then((result) => {
        if (!active) return;
        const claimTenantId =
          typeof result?.claims?.tenantId === "string"
            ? result.claims.tenantId
            : null;
        setTenantId(claimTenantId);
      })
      .catch(() => {
        if (!active) return;
        setTenantId(null);
      })
      .finally(() => {
        if (!active) return;
        setTenantLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const storedTenantId =
      localStorage.getItem("tenantId") ?? localStorage.getItem("rentaok:tenantId");
    if (storedTenantId && !tenantId) {
      setTenantId(storedTenantId);
    }
  }, [user, tenantId]);

  useEffect(() => {
    if (!user || tenantLoading || tenantId || autoDetecting || autoDetectChecked) {
      return;
    }
    let active = true;
    const detectTenant = async () => {
      setAutoDetecting(true);
      try {
        const snap = await getDocs(
          query(collectionGroup(db, "contracts"), limit(1))
        );
        if (!active) return;
        if (!snap.empty) {
          const path = snap.docs[0].ref.path;
          const match = path.match(/^tenants\/([^/]+)\/contracts\//);
          const detectedTenantId = match?.[1] ?? null;
          if (detectedTenantId) {
            localStorage.setItem("tenantId", detectedTenantId);
            localStorage.setItem("rentaok:tenantId", detectedTenantId);
            setTenantId(detectedTenantId);
            await setDoc(
              doc(db, "tenants", detectedTenantId),
              { updatedAt: serverTimestamp() },
              { merge: true }
            );
          }
        }
      } finally {
        if (active) {
          setAutoDetecting(false);
          setAutoDetectChecked(true);
        }
      }
    };

    detectTenant();
    return () => {
      active = false;
    };
  }, [user, tenantLoading, tenantId, autoDetecting, autoDetectChecked]);

  useEffect(() => {
    if (
      !tenantLoading &&
      !autoDetecting &&
      autoDetectChecked &&
      user &&
      !tenantId &&
      !pathname.startsWith("/tenants")
    ) {
      router.replace("/tenants");
    }
  }, [
    tenantLoading,
    autoDetecting,
    autoDetectChecked,
    user,
    tenantId,
    pathname,
    router,
  ]);

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 h-screen w-64 border-r border-border bg-surface px-5 py-6">
          <Link href="/dashboard" className="inline-flex items-center gap-2 py-0.5">
            <img
              src="/brand/logo.png"
              alt="RentaOK"
              className="h-20 w-auto"
            />
          </Link>
          <div className="mt-6 space-y-2 text-sm font-medium text-text-muted">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-surface-alt hover:text-text"
            >
              <span className="h-2 w-2 rounded-sm bg-muted" />
              Dashboard
            </Link>
            <Link
              href="/contracts"
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-surface-alt hover:text-text"
            >
              <span className="h-2 w-2 rounded-sm bg-muted" />
              Contratos
            </Link>
            <Link
              href="/canones"
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-surface-alt hover:text-text"
            >
              <span className="h-2 w-2 rounded-sm bg-muted" />
              Cánones
            </Link>
            <Link
              href="/pagos"
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-surface-alt hover:text-text"
            >
              <span className="h-2 w-2 rounded-sm bg-muted" />
              Pagos
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-surface-alt hover:text-text"
            >
              <span className="h-2 w-2 rounded-sm bg-muted" />
              Configuracion
            </Link>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
            <div className="flex items-center justify-between px-6 py-4 text-sm text-text-muted">
              <span>Panel operativo</span>
              <div className="flex items-center gap-3">
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
            {!tenantLoading &&
              (autoDetecting || autoDetectChecked) &&
              user &&
              !tenantId &&
              !pathname.startsWith("/tenants") && (
                <div className="mb-6 rounded-lg border border-zinc-200 bg-surface px-4 py-3 text-sm text-zinc-600">
                  Cargando...
                </div>
              )}
            {children}
          </main>
        </div>
      </div>
      <footer className="fixed bottom-0 left-0 right-0 border-t border-border bg-surface/95 px-6 py-3 text-xs text-text-muted backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-1">
          <div>RentaOK by Mentora®</div>
          <div>© 2025 Mentora. Todos los derechos reservados.</div>
          <div>
            RentaOK es una herramienta de gestión administrativa. No realiza
            cobranzas legales ni garantiza el pago. La información y los
            registros generados tienen fines operativos y documentales.
          </div>
        </div>
      </footer>
    </div>
  );
}


