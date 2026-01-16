"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { listPeople, TenantPerson } from "@/lib/db/tenantsPeople";
import { collectionGroup, getDocs, limit, query } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function TenantsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [people, setPeople] = useState<TenantPerson[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [detectedTenantId, setDetectedTenantId] = useState<string | null>(null);
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
          const detectedSnap = await getDocs(
            query(collectionGroup(db, "contracts"), limit(1))
          );
          if (!active) return;
          if (!detectedSnap.empty) {
            const path = detectedSnap.docs[0].ref.path;
            const match = path.match(/^tenants\/([^/]+)\/contracts\//);
            setDetectedTenantId(match?.[1] ?? null);
          } else {
            setDetectedTenantId(null);
          }
          return;
        }
        const list = await listPeople(nextTenantId);
        if (!active) return;
        setPeople(list);
        setDetectedTenantId(null);
      } catch (err: any) {
        if (!active) return;
        setPageError(err?.message ?? "No se pudieron cargar inquilinos.");
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
        <h1 className="text-2xl font-semibold text-zinc-900">Espacios</h1>
        <Link
          href="/tenants/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Crear espacio
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
      {!tenantId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div>
            Tu cuenta no esta vinculada a una oficina. Crea o solicita acceso.
          </div>
          <Link href="/debug" className="mt-2 inline-flex text-amber-800 underline">
            Abrir ayuda
          </Link>
        </div>
      )}
      {people.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-6 text-sm text-zinc-600">
          <div>No hay espacios cargados.</div>
          {detectedTenantId && (
            <button
              type="button"
              onClick={() => {
                localStorage.setItem("tenantId", detectedTenantId);
                localStorage.setItem("rentaok:tenantId", detectedTenantId);
                router.push("/dashboard");
              }}
              className="mt-3 rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Usar espacio detectado
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {people.map((person) => (
            <li
              key={person.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4"
            >
              <div>
                <div className="text-sm font-medium text-zinc-900">
                  {person.fullName}
                </div>
                <div className="text-xs text-zinc-500">
                  {person.dni ? `DNI: ${person.dni}` : "DNI: -"} |{" "}
                  {person.phone ? `Tel: ${person.phone}` : "Tel: -"}
                </div>
              </div>
              <Link
                href={`/tenants/${person.id}`}
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
