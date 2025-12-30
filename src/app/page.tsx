"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { ensureUserProfile, getUserProfile } from "@/lib/db/users";
import { getTenant } from "@/lib/db/tenants";

export default function DashboardPage() {
  const { user, loading, error, logout } = useAuth();
  const router = useRouter();
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || loading) return;

    let active = true;
    const loadProfile = async () => {
      setProfileLoading(true);
      setProfileError(null);
      try {
        await ensureUserProfile(user);
        const profile = await getUserProfile(user.uid);
        if (!active) return;
        const nextTenantId = profile?.tenantId ?? null;
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          router.replace("/onboarding");
          return;
        }
        const tenant = await getTenant(nextTenantId);
        if (!active) return;
        setTenantName(tenant?.name ?? null);
      } catch (err: any) {
        if (!active) return;
        setProfileError(err?.message ?? "No se pudo cargar el perfil.");
      } finally {
        if (active) setProfileLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [user, loading, router, reloadToken]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-600">
        Cargando...
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900">RentaOK</h1>
          <p className="text-sm text-zinc-600">Sesion iniciada correctamente.</p>
        </div>
        {error && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </div>
        )}
        {profileError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {profileError}
          </div>
        )}
        {profileLoading ? (
          <div className="mb-4 text-sm text-zinc-600">Cargando perfil...</div>
        ) : (
          <div className="mb-4 text-sm text-zinc-600">
            Tenant: {tenantName ?? tenantId ?? "sin tenant"}
          </div>
        )}
        <div className="mb-4 text-sm text-zinc-600">Email</div>
        <div className="mb-6 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900">
          {user.email}
        </div>
        {profileError && (
          <button
            type="button"
            onClick={() => {
              setProfileError(null);
              setReloadToken((token) => token + 1);
            }}
            className="mb-3 w-full rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Reintentar
          </button>
        )}
        <button
          type="button"
          onClick={logout}
          className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Cerrar sesion
        </button>
      </div>
    </main>
  );
}
