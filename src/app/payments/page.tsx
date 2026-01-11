"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { db } from "@/lib/firebase";
import { toDateSafe } from "@/lib/utils/firestoreDate";

type InstallmentRecord = {
  id: string;
  contractId?: string;
  period?: string;
  status?: string;
  dueDate?: unknown;
  totals?: {
    total?: number;
    paid?: number;
    due?: number;
  };
};

export default function PaymentsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [installments, setInstallments] = useState<InstallmentRecord[]>([]);
  const [installmentsLoading, setInstallmentsLoading] = useState(false);
  const [installmentsError, setInstallmentsError] = useState<string | null>(null);

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
        }
      } catch (err: any) {
        if (!active) return;
        setPageError(err?.message ?? "No se pudo cargar pagos.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    load();
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
        const installmentsRef = collection(db, "tenants", tenantId, "installments");
        const q = query(
          installmentsRef,
          where("status", "in", ["VENCIDA", "POR_VENCER", "VENCE_HOY", "PARCIAL", "PAGADA"]),
          orderBy("dueDate", "asc"),
          limit(200)
        );
        const snap = await getDocs(q);
        if (!active) return;
        setInstallments(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<InstallmentRecord, "id">),
          }))
        );
      } catch (err: any) {
        if (!active) return;
        setInstallmentsError("No se pudieron cargar las cuotas.");
      } finally {
        if (active) setInstallmentsLoading(false);
      }
    };

    loadInstallments();
    return () => {
      active = false;
    };
  }, [tenantId]);

  const formatDueDate = (value: InstallmentRecord["dueDate"]) => {
    const date = toDateSafe(value);
    return date ? date.toLocaleString() : "-";
  };

  const formatAmount = (value?: number) =>
    Number(value ?? 0).toLocaleString("es-AR");

  const statusBuckets = installments.reduce(
    (acc, item) => {
      const status = (item.status ?? "").toUpperCase();
      if (status === "VENCIDA") acc.overdue.push(item);
      else if (status === "POR_VENCER" || status === "VENCE_HOY") acc.dueSoon.push(item);
      else if (status === "PARCIAL") acc.partial.push(item);
      else if (status === "PAGADA") acc.paid.push(item);
      else acc.other.push(item);
      return acc;
    },
    {
      overdue: [] as InstallmentRecord[],
      dueSoon: [] as InstallmentRecord[],
      partial: [] as InstallmentRecord[],
      paid: [] as InstallmentRecord[],
      other: [] as InstallmentRecord[],
    }
  );

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
        <div>Necesitas crear un tenant para continuar.</div>
        <Link
          href="/onboarding"
          className="mt-2 inline-flex text-xs font-medium text-zinc-700 hover:text-zinc-900"
        >
          Ir a onboarding
        </Link>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-zinc-900">Pagos</h1>
        <p className="text-sm text-zinc-600">
          Vista global de vencidos / por vencer / parciales
        </p>
      </div>

      {installmentsLoading ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          Cargando pagos...
        </div>
      ) : installmentsError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {installmentsError}
        </div>
      ) : installments.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          <div>No hay cuotas generadas todavia.</div>
          <Link
            href="/contracts"
            className="mt-2 inline-flex rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Ir a contratos
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {[
            { key: "Vencidas", items: statusBuckets.overdue },
            { key: "Por vencer / vence hoy", items: statusBuckets.dueSoon },
            { key: "Parciales", items: statusBuckets.partial },
            { key: "Pagadas", items: statusBuckets.paid },
          ].map((section) => (
            <div key={section.key} className="space-y-2">
              <h2 className="text-sm font-semibold text-zinc-900">{section.key}</h2>
              {section.items.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
                  Sin cuotas en esta categoria.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-surface">
                  <table className="min-w-full text-sm text-zinc-700">
                    <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Periodo</th>
                        <th className="px-3 py-2 text-left font-medium">Vencimiento</th>
                        <th className="px-3 py-2 text-left font-medium">Monto</th>
                        <th className="px-3 py-2 text-left font-medium">Estado</th>
                        <th className="px-3 py-2 text-left font-medium">Contrato</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {section.items.map((installment) => (
                        <tr key={installment.id} className="bg-white">
                          <td className="px-3 py-2 font-medium text-zinc-900">
                            {installment.period ?? "-"}
                          </td>
                          <td className="px-3 py-2">{formatDueDate(installment.dueDate)}</td>
                          <td className="px-3 py-2">
                            {formatAmount(installment.totals?.total)}
                          </td>
                          <td className="px-3 py-2 text-xs uppercase text-zinc-600">
                            {installment.status ?? "-"}
                          </td>
                          <td className="px-3 py-2">
                            {installment.contractId ? (
                              <Link
                                href={`/contracts/${installment.contractId}`}
                                className="text-xs font-medium text-zinc-700 hover:text-zinc-900"
                              >
                                Ver contrato
                              </Link>
                            ) : (
                              <span className="text-xs text-zinc-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
