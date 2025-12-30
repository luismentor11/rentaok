"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { listContracts, ContractRecord } from "@/lib/db/contracts";

export default function ContractsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
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
        const list = await listContracts(nextTenantId);
        if (!active) return;
        setContracts(list);
      } catch (err: any) {
        if (!active) return;
        setPageError(err?.message ?? "No se pudieron cargar contratos.");
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
        <h1 className="text-2xl font-semibold text-zinc-900">Contratos</h1>
        <Link
          href="/contracts/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Nuevo contrato
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
      {contracts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-6 text-sm text-zinc-600">
          Sin contratos cargados.
        </div>
      ) : (
        <ul className="space-y-3">
          {contracts.map((contract) => (
            <li
              key={contract.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4"
            >
              <div>
                <div className="text-sm font-medium text-zinc-900">
                  {contract.property.title}
                </div>
                <div className="text-xs text-zinc-500">
                  Locatario: {contract.parties.tenant.fullName} | Propietario:{" "}
                  {contract.parties.owner.fullName}
                </div>
              </div>
              <Link
                href={`/contracts/${contract.id}`}
                className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
              >
                Ver detalle
              </Link>
            </li>
          ))}
        </ul>
      )}
      {tenantId && (
        <div className="text-xs text-zinc-400">Tenant: {tenantId}</div>
      )}
    </section>
  );
}
