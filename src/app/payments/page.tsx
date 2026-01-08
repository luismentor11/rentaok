"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import {
  listInstallmentsForTenant,
  InstallmentRecord,
} from "@/lib/db/installments";

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
        const list = await listInstallmentsForTenant(tenantId, { status: "ALL" });
        if (!active) return;
        setInstallments(list);
      } catch (err: any) {
        if (!active) return;
        setInstallmentsError("No se pudieron cargar los pagos.");
      } finally {
        if (active) setInstallmentsLoading(false);
      }
    };

    loadInstallments();
    return () => {
      active = false;
    };
  }, [tenantId]);

  const getPaymentStatusLabel = (status: string) => {
    const normalized = status.trim().toUpperCase();
    if (normalized === "PAGADA") return "paid";
    if (normalized === "VENCIDA") return "overdue";
    return "pending";
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

      {installmentsLoading ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          Cargando pagos...
        </div>
      ) : installmentsError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {installmentsError}
        </div>
      ) : installments.length === 0 ? (
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
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-surface">
          <table className="min-w-full text-sm text-zinc-700">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Periodo</th>
                <th className="px-3 py-2 text-left font-medium">Estado</th>
                <th className="px-3 py-2 text-left font-medium">Contrato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {installments.map((installment) => (
                <tr key={installment.id} className="bg-white">
                  <td className="px-3 py-2 font-medium text-zinc-900">
                    {installment.period}
                  </td>
                  <td className="px-3 py-2">
                    {getPaymentStatusLabel(installment.status)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/contracts/${installment.contractId}`}
                      className="text-xs font-medium text-zinc-700 hover:text-zinc-900"
                    >
                      Ver contrato
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
