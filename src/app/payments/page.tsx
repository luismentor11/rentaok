"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collectionGroup, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { db } from "@/lib/firebase";
import { toDateSafe } from "@/lib/utils/firestoreDate";

type PaymentRecord = {
  id: string;
  tenantId?: string;
  contractId?: string;
  installmentId?: string;
  amount?: number;
  method?: string;
  paidAt?: unknown;
  note?: string;
};

export default function PaymentsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);

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
    const loadPayments = async () => {
      setPaymentsLoading(true);
      setPaymentsError(null);
      try {
        const q = query(
          collectionGroup(db, "payments"),
          where("tenantId", "==", tenantId),
          orderBy("paidAt", "desc"),
          limit(50)
        );
        const snap = await getDocs(q);
        if (!active) return;
        setPayments(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<PaymentRecord, "id">),
          }))
        );
      } catch (err: any) {
        if (!active) return;
        setPaymentsError("No se pudieron cargar los pagos.");
      } finally {
        if (active) setPaymentsLoading(false);
      }
    };

    loadPayments();
    return () => {
      active = false;
    };
  }, [tenantId]);

  const formatPaidAt = (value: PaymentRecord["paidAt"]) => {
    const date = toDateSafe(value);
    return date ? date.toLocaleString() : "-";
  };

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

      {paymentsLoading ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          Cargando pagos...
        </div>
      ) : paymentsError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {paymentsError}
        </div>
      ) : payments.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          <div>No hay pagos para mostrar.</div>
          <Link
            href="/contracts"
            className="mt-2 inline-flex rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Ir a contratos
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-surface">
            <table className="min-w-full text-sm text-zinc-700">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Fecha</th>
                  <th className="px-3 py-2 text-left font-medium">Monto</th>
                  <th className="px-3 py-2 text-left font-medium">Metodo</th>
                  <th className="px-3 py-2 text-left font-medium">Contrato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {payments.map((payment) => (
                  <tr key={payment.id} className="bg-white">
                    <td className="px-3 py-2 font-medium text-zinc-900">
                      {formatPaidAt(payment.paidAt)}
                    </td>
                    <td className="px-3 py-2">
                      {Number(payment.amount ?? 0).toLocaleString("es-AR")}
                    </td>
                    <td className="px-3 py-2 text-xs uppercase text-zinc-600">
                      {payment.method ?? "-"}
                    </td>
                    <td className="px-3 py-2">
                      {payment.contractId ? (
                        <Link
                          href={`/contracts/${payment.contractId}`}
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
        </div>
      )}
    </section>
  );
}
