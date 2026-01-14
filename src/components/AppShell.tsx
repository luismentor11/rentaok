"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
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
  const [officeName, setOfficeName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!user) {
      setTenantId(null);
      setTenantLoading(false);
      setAutoDetectChecked(false);
      setAutoDetecting(false);
      return;
    }
    setTenantLoading(true);
    setAutoDetecting(false);
    setAutoDetectChecked(false);

    const resolveTenant = async () => {
      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (!active) return;
        const profileTenantId =
          typeof userSnap.data()?.tenantId === "string"
            ? userSnap.data()?.tenantId
            : null;
        if (profileTenantId) {
          setTenantId(profileTenantId);
          localStorage.setItem("tenantId", profileTenantId);
          localStorage.setItem("rentaok:tenantId", profileTenantId);
          return;
        }

        setAutoDetecting(true);
        const contractsSnap = await getDocs(
          query(
            collectionGroup(db, "contracts"),
            where("createdByUid", "==", user.uid),
            limit(1)
          )
        );
        if (!active) return;
        if (!contractsSnap.empty) {
          const path = contractsSnap.docs[0].ref.path;
          const match = path.match(/^tenants\/([^/]+)\/contracts\//);
          const detectedTenantId = match?.[1] ?? null;
          if (detectedTenantId) {
            setTenantId(detectedTenantId);
            localStorage.setItem("tenantId", detectedTenantId);
            localStorage.setItem("rentaok:tenantId", detectedTenantId);
            try {
              await setDoc(
                userRef,
                { tenantId: detectedTenantId, updatedAt: serverTimestamp() },
                { merge: true }
              );
            } catch (error) {
              console.warn(
                "No se pudo persistir tenantId en users/{uid}",
                error
              );
            }
          }
        }
      } finally {
        if (!active) return;
        setAutoDetecting(false);
        setAutoDetectChecked(true);
        setTenantLoading(false);
      }
    };

    resolveTenant();

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !tenantId) return;
    let active = true;
    const persistTenantId = async () => {
      try {
        await setDoc(
          doc(db, "users", user.uid),
          { tenantId, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch (error) {
        if (!active) return;
        console.warn("No se pudo persistir tenantId en users/{uid}", error);
      }
    };

    persistTenantId();
    return () => {
      active = false;
    };
  }, [user, tenantId]);

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
              className="h-32 w-auto"
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
              Canon/Mes
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
            {(tenantLoading || autoDetecting) &&
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


