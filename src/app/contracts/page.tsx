"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { listContractsPage, ContractRecord } from "@/lib/db/contracts";
import { recordDebugError } from "@/lib/debug";

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
  const [searchTerm, setSearchTerm] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "ENDED">(
    "ALL"
  );

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
        setContracts(
          page.items.filter((item) => (item as { status?: string }).status !== "deleted")
        );
        setCursor(page.nextCursor);
        setHasMore(!!page.nextCursor);
      } catch (err: any) {
        if (!active) return;
        console.error("Contracts:list", err);
        recordDebugError("contracts:list", err);
        setPageError("No se pudieron cargar contratos.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [user, loading, router, reloadToken]);

  const normalizeText = (value: string) => value.toLowerCase().trim();

  const getShortId = (value: string) =>
    value && value.length > 6 ? value.slice(0, 6) : value;

  const getContractStatus = (contract: ContractRecordWithProperty) => {
    const endValue = contract.dates?.endDate ?? "";
    if (!endValue) return "ACTIVE";
    const endDate = new Date(`${endValue}T00:00:00`);
    if (!Number.isFinite(endDate.getTime())) return "ACTIVE";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return endDate < today ? "ENDED" : "ACTIVE";
  };

  const ownerOptions = useMemo(() => {
    const owners = new Set<string>();
    contracts.forEach((contract) => {
      const name = contract.parties?.owner?.fullName?.trim();
      if (name) owners.add(name);
    });
    return Array.from(owners).sort((a, b) => a.localeCompare(b));
  }, [contracts]);

  const filteredContracts = useMemo(() => {
    const search = normalizeText(searchTerm);
    return contracts.filter((contract) => {
      const tenantName = contract.parties?.tenant?.fullName ?? "";
      const ownerName = contract.parties?.owner?.fullName ?? "";
      const address = contract.property?.address ?? "";
      const shortId = getShortId(contract.id ?? "");
      const status = getContractStatus(contract);
      const ownerMatch =
        ownerFilter === "ALL" || ownerName === ownerFilter;
      const statusMatch =
        statusFilter === "ALL" || statusFilter === status;
      const searchMatch = !search
        ? true
        : [tenantName, ownerName, address, shortId]
            .map((value) => normalizeText(String(value)))
            .some((value) => value.includes(search));
      return ownerMatch && statusMatch && searchMatch;
    });
  }, [contracts, ownerFilter, searchTerm, statusFilter]);

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
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
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
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[220px] flex-1 flex-col">
          <label className="text-xs font-medium text-text-muted">Buscar</label>
          <div className="relative mt-1">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Inquilino, propietario, direccion o ID corto"
              className="w-full rounded-md border border-border bg-white py-2 pl-9 pr-3 text-sm text-text"
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>
        <div className="flex min-w-[200px] flex-col">
          <label className="text-xs font-medium text-text-muted">
            Propietario
          </label>
          <select
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
            className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-sm text-text"
          >
            <option value="ALL">Todos</option>
            {ownerOptions.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-[160px] flex-col">
          <label className="text-xs font-medium text-text-muted">Estado</label>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "ALL" | "ACTIVE" | "ENDED")
            }
            className="mt-1 rounded-md border border-border bg-white px-3 py-2 text-sm text-text"
          >
            <option value="ALL">Todos</option>
            <option value="ACTIVE">Activo</option>
            <option value="ENDED">Finalizado</option>
          </select>
        </div>
      </div>
      {filteredContracts.length === 0 ? (
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
          {filteredContracts.map((contract) => (
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
              const nextItems = page.items.filter(
                (item) => (item as { status?: string }).status !== "deleted"
              );
              setContracts((prev) => [...prev, ...nextItems]);
              setCursor(page.nextCursor);
              setHasMore(!!page.nextCursor);
            } catch (err: any) {
              console.error("Contracts:list:more", err);
              recordDebugError("contracts:list:more", err);
              setMoreError("No se pudo cargar mas.");
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
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          No se pudo cargar mas. Intenta de nuevo.
        </div>
      )}
    </section>
  );
}
