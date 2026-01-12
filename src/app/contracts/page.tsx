"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { listContractsPage, ContractRecord } from "@/lib/db/contracts";

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
  const [cursor, setCursor] = useState<any | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
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
        setContracts([]);
        setCursor(null);
        setHasMore(false);
        setLoadingMore(false);
        setMoreError(null);
        const page = await listContractsPage(nextTenantId, { pageSize: 20 });
        if (!active) return;
        setContracts(page.items);
        setCursor(page.nextCursor);
        setHasMore(!!page.nextCursor);
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
    return (
      <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
        Cargando...
      </div>
    );
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
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Ocurrio un error. Intenta de nuevo.
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
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          <div>No hay contratos para mostrar.</div>
          <Link
            href="/contracts/new"
            className="mt-2 inline-flex rounded-md border border-border bg-surface-alt px-3 py-2 text-xs font-semibold text-text hover:bg-surface"
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
      {contracts.length > 0 && hasMore && !pageError && (
        <button
          type="button"
          onClick={async () => {
            if (!tenantId || loadingMore || !hasMore) return;
            setLoadingMore(true);
            setMoreError(null);
            try {
              const page = await listContractsPage(tenantId, {
                pageSize: 20,
                cursor,
              });
              setContracts((prev) => [...prev, ...page.items]);
              setCursor(page.nextCursor);
              setHasMore(!!page.nextCursor);
            } catch (err: any) {
              setMoreError(err?.message ?? "Could not load more contracts.");
            } finally {
              setLoadingMore(false);
            }
          }}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:bg-surface-alt"
        >
          {loadingMore ? "Cargando..." : "Cargar mas"}
        </button>
      )}
      {moreError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          No se pudo cargar mas. Intenta de nuevo.
        </div>
      )}
    </section>
  );
}
