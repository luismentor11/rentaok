"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  collectionGroup,
  documentId,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { recordDebugError } from "@/lib/debug";
import { db } from "@/lib/firebase";
import { toDateSafe } from "@/lib/utils/firestoreDate";
import type { ContractRecord } from "@/lib/db/contracts";
import type { PaymentMethod } from "@/lib/db/installments";

type PaymentRecord = {
  id: string;
  tenantId?: string;
  contractId?: string;
  installmentId?: string;
  amount?: number;
  paidAt?: unknown;
  method?: PaymentMethod;
  period?: string;
};

type ContractMap = Record<string, ContractRecord>;

const formatAmount = (value?: number) =>
  Number(value ?? 0).toLocaleString("es-AR");

const chunkIds = (ids: string[], size: number) => {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
};

export default function PagosPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [contractsById, setContractsById] = useState<ContractMap>({});

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
        setPageError(err?.message ?? "No se pudieron cargar pagos.");
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
    const loadPayments = async () => {
      setPaymentsLoading(true);
      setPaymentsError(null);
      try {
        const paymentsSnap = await getDocs(
          query(
            collectionGroup(db, "payments"),
            where("tenantId", "==", tenantId),
            limit(200)
          )
        );
        if (!active) return;
        setPayments(
          paymentsSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<PaymentRecord, "id">),
          }))
        );
      } catch (err: any) {
        if (!active) return;
        console.error("PaymentsPage:query", err);
        recordDebugError("payments:query", err);
        setPaymentsError("No pudimos cargar pagos. Reintentá.");
        setPayments([]);
      } finally {
        if (active) setPaymentsLoading(false);
      }
    };

    loadPayments();
    return () => {
      active = false;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    const loadContracts = async () => {
      const contractIds = Array.from(
        new Set(payments.map((item) => item.contractId).filter(Boolean))
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
  }, [tenantId, payments]);

  const rows = useMemo(() => {
    return [...payments].sort((a, b) => {
      const dateA = toDateSafe(a.paidAt)?.getTime() ?? 0;
      const dateB = toDateSafe(b.paidAt)?.getTime() ?? 0;
      return dateB - dateA;
    });
  }, [payments]);

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
        {pageError}
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
        <h1 className="text-2xl font-semibold text-zinc-900">Pagos</h1>
        <p className="text-sm text-zinc-600">
          Movimientos registrados en Canon/Mes.
        </p>
      </div>

      {paymentsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {paymentsError}
        </div>
      )}

      {paymentsLoading ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          Cargando...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          No hay pagos registrados todavía.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full text-sm text-zinc-700">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Fecha</th>
                <th className="px-3 py-2 text-left font-medium">Monto</th>
                <th className="px-3 py-2 text-left font-medium">Metodo</th>
                <th className="px-3 py-2 text-left font-medium">Periodo</th>
                <th className="px-3 py-2 text-left font-medium">Contrato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {rows.map((payment) => {
                const contract = payment.contractId
                  ? contractsById[payment.contractId]
                  : undefined;
                const propertyTitle = contract?.property?.title ?? "-";
                const propertyAddress = contract?.property?.address ?? "-";
                const ownerName = contract?.parties?.owner?.fullName ?? "-";
                const tenantName = contract?.parties?.tenant?.fullName ?? "-";
                const paidAt = toDateSafe(payment.paidAt);
                return (
                  <tr key={payment.id} className="bg-white">
                    <td className="px-3 py-2">
                      {paidAt ? paidAt.toLocaleString() : "-"}
                    </td>
                    <td className="px-3 py-2">
                      {formatAmount(payment.amount)}
                    </td>
                    <td className="px-3 py-2">
                      {payment.method ?? "-"}
                    </td>
                    <td className="px-3 py-2">{payment.period ?? "-"}</td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-zinc-500">
                        <div className="font-medium text-zinc-900">
                          {propertyTitle}
                        </div>
                        <div>{propertyAddress}</div>
                        <div>
                          {ownerName} / {tenantName}
                        </div>
                        {payment.contractId && (
                          <Link
                            href={`/contracts/${payment.contractId}`}
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

