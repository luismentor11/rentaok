"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { listContracts, ContractRecord } from "@/lib/db/contracts";

type ContractRecordWithProperty = ContractRecord & {
  property?: {
    title?: string;
    address?: string;
  };
};

export default function ContractsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [contracts, setContracts] = useState<ContractRecordWithProperty[]>([]);
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
    return <div className="text-sm text-text-muted">Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  if (!tenantId) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted">
        <div>Necesitas crear un tenant para continuar.</div>
        <Link
          href="/onboarding"
          className="mt-2 inline-flex text-xs font-medium text-text hover:text-text-muted"
        >
          Ir a onboarding
        </Link>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Contratos</h1>
        <Link
          href="/contracts/new"
          className="rounded-md border border-border bg-surface-alt px-4 py-2 text-sm font-semibold text-text hover:bg-surface"
        >
          Nuevo contrato
        </Link>
      </div>
      {pageError && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          No se pudieron cargar los contratos.
        </div>
      )}
      {pageError && (
        <button
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:bg-surface-alt"
        >
          Reintentar
        </button>
      )}
      {contracts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          <div>Todavia no tenes contratos.</div>
          <Link
            href="/contracts/new"
            className="mt-3 inline-flex rounded-md border border-border bg-surface-alt px-3 py-2 text-xs font-semibold text-text hover:bg-surface"
          >
            Crear contrato
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {contracts.map((contract) => (
            <li
              key={contract.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface p-4"
            >
              <div>
                <div className="text-sm font-medium text-text">
                  {contract.property?.title || "-"}
                </div>
                <div className="text-xs text-text-muted">
                  Locatario: {contract.parties.tenant.fullName} | Propietario:{" "}
                  {contract.parties.owner.fullName}
                </div>
              </div>
              <Link
                href={`/contracts/${contract.id}`}
                className="text-sm font-medium text-text hover:text-text-muted"
              >
                Ver detalle
              </Link>
            </li>
          ))}
        </ul>
      )}
      {tenantId && (
        <div className="text-xs text-text-muted">Tenant: {tenantId}</div>
      )}
    </section>
  );
}
