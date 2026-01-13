"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  collection,
  documentId,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { db } from "@/lib/firebase";
import { toDateSafe } from "@/lib/utils/firestoreDate";
import type { ContractRecord } from "@/lib/db/contracts";
import type { InstallmentRecord } from "@/lib/db/installments";

type ContractMap = Record<string, ContractRecord>;

const statusOptions = [
  { value: "ALL", label: "Todos" },
  { value: "VENCIDA", label: "Vencida" },
  { value: "POR_VENCER", label: "Por vencer" },
  { value: "VENCE_HOY", label: "Vence hoy" },
  { value: "PARCIAL", label: "Parcial" },
  { value: "PAGADA", label: "Pagada" },
] as const;

const formatAmount = (value?: number) =>
  Number(value ?? 0).toLocaleString("es-AR");

const buildMonthValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const getMonthRange = (monthValue: string) => {
  const [yearText, monthText] = monthValue.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0) {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
  }
  return {
    start: new Date(year, monthIndex, 1),
    end: new Date(year, monthIndex + 1, 1),
  };
};

const chunkIds = (ids: string[], size: number) => {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
};

export default function CanonesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [installments, setInstallments] = useState<InstallmentRecord[]>([]);
  const [installmentsLoading, setInstallmentsLoading] = useState(false);
  const [installmentsError, setInstallmentsError] = useState<string | null>(null);
  const [contractsById, setContractsById] = useState<ContractMap>({});

  const [statusFilter, setStatusFilter] = useState<
    (typeof statusOptions)[number]["value"]
  >("ALL");
  const [monthFilter, setMonthFilter] = useState(buildMonthValue(new Date()));
  const [searchTerm, setSearchTerm] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || loading) return;
    let active = true;
    const loadProfile = async () => {
      setPageLoading(true);
      setPageError(null);
      try {
        const profile = await getUserProfile(user.uid);
        if (!active) return;
        const nextTenantId = profile?.tenantId ?? null;
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          router.replace("/onboarding");
        }
      } catch (err: any) {
        if (!active) return;
        setPageError(err?.message ?? "No se pudo cargar Canon/Mes.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [user, loading, router]);

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    const loadInstallments = async () => {
      setInstallmentsLoading(true);
      setInstallmentsError(null);
      try {
        const { start, end } = getMonthRange(monthFilter);
        const constraints = [
          where("dueDate", ">=", Timestamp.fromDate(start)),
          where("dueDate", "<", Timestamp.fromDate(end)),
          orderBy("dueDate", "asc"),
        ];
        if (statusFilter !== "ALL") {
          constraints.unshift(where("status", "==", statusFilter));
        }
        const installmentsRef = collection(
          db,
          "tenants",
          tenantId,
          "installments"
        );
        const q = query(installmentsRef, ...constraints);
        const snap = await getDocs(q);
        if (!active) return;
        const nextInstallments = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<InstallmentRecord, "id">),
        }));
        setInstallments(nextInstallments);
      } catch (err: any) {
        if (!active) return;
        setInstallmentsError(err?.message ?? "No se pudieron cargar periodos.");
        setInstallments([]);
      } finally {
        if (active) setInstallmentsLoading(false);
      }
    };

    loadInstallments();
    return () => {
      active = false;
    };
  }, [tenantId, monthFilter, statusFilter]);

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    const loadContracts = async () => {
      const contractIds = Array.from(
        new Set(installments.map((item) => item.contractId).filter(Boolean))
      ) as string[];
      if (contractIds.length === 0) {
        if (active) setContractsById({});
        return;
      }
      try {
        const chunks = chunkIds(contractIds, 10);
        const contractsRef = collection(
          db,
          "tenants",
          tenantId,
          "contracts"
        );
        const snapshots = await Promise.all(
          chunks.map((chunk) =>
            getDocs(query(contractsRef, where(documentId(), "in", chunk)))
          )
        );
        if (!active) return;
        const nextMap: ContractMap = {};
        snapshots.forEach((snap) => {
          snap.docs.forEach((docSnap) => {
            nextMap[docSnap.id] = {
              id: docSnap.id,
              ...(docSnap.data() as Omit<ContractRecord, "id">),
            };
          });
        });
        setContractsById(nextMap);
      } catch {
        if (active) setContractsById({});
      }
    };

    loadContracts();
    return () => {
      active = false;
    };
  }, [tenantId, installments]);

  const filteredInstallments = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const ownerSearch = ownerFilter.trim().toLowerCase();
    if (!search && !ownerSearch) return installments;
    return installments.filter((installment) => {
      const contract = installment.contractId
        ? contractsById[installment.contractId]
        : undefined;
      const propertyTitle = contract?.property?.title ?? "";
      const propertyAddress = contract?.property?.address ?? "";
      const ownerName = contract?.parties?.owner?.fullName ?? "";
      const tenantName = contract?.parties?.tenant?.fullName ?? "";
      const haystack = `${propertyTitle} ${propertyAddress} ${ownerName} ${tenantName}`
        .toLowerCase()
        .trim();
      const ownerMatch = ownerSearch
        ? ownerName.toLowerCase().includes(ownerSearch)
        : true;
      const textMatch = search ? haystack.includes(search) : true;
      return ownerMatch && textMatch;
    });
  }, [installments, contractsById, searchTerm, ownerFilter]);

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

  if (pageError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        Ocurrio un error. Intenta de nuevo.
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        Necesitas un tenant para continuar.
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-zinc-900">Canon/Mes</h1>
        <p className="text-sm text-zinc-600">
          Vista global de periodos por contrato.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs font-medium text-zinc-600">Estado</label>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as (typeof statusOptions)[number]["value"]
              )
            }
            className="mt-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium text-zinc-600">Mes</label>
          <input
            type="month"
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
            className="mt-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
          />
        </div>
        <div className="flex flex-1 flex-col min-w-[200px]">
          <label className="text-xs font-medium text-zinc-600">Busqueda</label>
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="mt-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
            placeholder="Propiedad, locatario, propietario"
          />
        </div>
        <div className="flex flex-1 flex-col min-w-[200px]">
          <label className="text-xs font-medium text-zinc-600">
            Propietario/a
          </label>
          <input
            type="text"
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
            className="mt-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
            placeholder="Nombre del propietario"
          />
        </div>
      </div>

      {installmentsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {installmentsError}
        </div>
      )}

      {installmentsLoading ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          Cargando...
        </div>
      ) : filteredInstallments.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          No hay períodos para este filtro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full text-sm text-zinc-700">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Periodo</th>
                <th className="px-3 py-2 text-left font-medium">Estado</th>
                <th className="px-3 py-2 text-left font-medium">Vencimiento</th>
                <th className="px-3 py-2 text-left font-medium">Total</th>
                <th className="px-3 py-2 text-left font-medium">Pagado</th>
                <th className="px-3 py-2 text-left font-medium">Saldo</th>
                <th className="px-3 py-2 text-left font-medium">Contrato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {filteredInstallments.map((installment) => {
                const contract = installment.contractId
                  ? contractsById[installment.contractId]
                  : undefined;
                const propertyTitle = contract?.property?.title ?? "-";
                const propertyAddress = contract?.property?.address ?? "-";
                const ownerName = contract?.parties?.owner?.fullName ?? "-";
                const tenantName = contract?.parties?.tenant?.fullName ?? "-";
                const dueDate = toDateSafe(installment.dueDate);
                return (
                  <tr key={installment.id} className="bg-white">
                    <td className="px-3 py-2 font-medium text-zinc-900">
                      {installment.period ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-xs uppercase text-zinc-600">
                      {installment.status ?? "-"}
                    </td>
                    <td className="px-3 py-2">
                      {dueDate ? dueDate.toLocaleDateString() : "-"}
                    </td>
                    <td className="px-3 py-2">
                      {formatAmount(installment.totals?.total)}
                    </td>
                    <td className="px-3 py-2">
                      {formatAmount(installment.totals?.paid)}
                    </td>
                    <td className="px-3 py-2">
                      {formatAmount(installment.totals?.due)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-zinc-500">
                        <div className="font-medium text-zinc-900">
                          {propertyTitle}
                        </div>
                        <div>{propertyAddress}</div>
                        <div>
                          {ownerName} / {tenantName}
                        </div>
                        {installment.contractId && (
                          <Link
                            href={`/contracts/${installment.contractId}`}
                            className="text-xs font-semibold text-zinc-700 hover:text-zinc-900"
                          >
                            Abrir contrato
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
