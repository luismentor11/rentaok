"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { listProperties, Property } from "@/lib/db/properties";

export default function PropertiesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || loading) return;
    let active = true;

    const load = async () => {
      setPageLoading(true);
      setPageError(null);
      try {
        const profile = await getUserProfile(user.uid);
        if (!active) return;
        const nextTenantId = profile?.tenantId ?? null;
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          router.replace("/onboarding");
          return;
        }
        const list = await listProperties(nextTenantId);
        if (!active) return;
        setProperties(list);
      } catch (err: any) {
        if (!active) return;
        setPageError(err?.message ?? "No se pudieron cargar propiedades.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [user, loading, router, reloadToken]);

  if (loading || pageLoading) {
    return <div className="text-sm text-zinc-600">Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">Propiedades</h1>
        <Link
          href="/properties/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Nueva propiedad
        </Link>
      </div>
      {pageError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {pageError}
        </div>
      )}
      {pageError && (
        <button
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
          className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Reintentar
        </button>
      )}
      {properties.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-6 text-sm text-zinc-600">
          Sin propiedades cargadas.
        </div>
      ) : (
        <ul className="space-y-3">
          {properties.map((property) => (
            <li
              key={property.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4"
            >
              <div>
                <div className="text-sm font-medium text-zinc-900">
                  {property.title}
                </div>
                <div className="text-xs text-zinc-500">
                  Estado: {property.status}
                </div>
              </div>
              <Link
                href={`/properties/${property.id}`}
                className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
              >
                Editar
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
