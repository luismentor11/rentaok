"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { getContract, ContractRecord } from "@/lib/db/contracts";
import {
  generateInstallmentsForContract,
  listInstallmentsByContract,
  InstallmentRecord,
} from "@/lib/db/installments";

const tabOptions = [
  { key: "cuotas", label: "Cuotas" },
  { key: "garantes", label: "Garantes" },
  { key: "notificaciones", label: "Config Notificaciones" },
  { key: "bitacora", label: "Bitacora" },
  { key: "zip", label: "Export ZIP" },
] as const;

type TabKey = (typeof tabOptions)[number]["key"];

type PageProps = {
  params: { id: string };
};

export default function ContractDetailPage({ params }: PageProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [contract, setContract] = useState<ContractRecord | null>(null);
  const [installments, setInstallments] = useState<InstallmentRecord[]>([]);
  const [installmentsLoading, setInstallmentsLoading] = useState(false);
  const [installmentsError, setInstallmentsError] = useState<string | null>(
    null
  );
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("cuotas");

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
      setError(null);
      try {
        const profile = await getUserProfile(user.uid);
        if (!active) return;
        const nextTenantId = profile?.tenantId ?? null;
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          router.replace("/onboarding");
          return;
        }
        const data = await getContract(nextTenantId, params.id);
        if (!active) return;
        if (!data) {
          setError("Contrato no encontrado.");
          return;
        }
        setContract(data);
      } catch (err: any) {
        if (!active) return;
        setError(err?.message ?? "No se pudo cargar el contrato.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [user, loading, router, params.id]);

  const formatDueDate = (value: InstallmentRecord["dueDate"]) => {
    const date =
      typeof (value as any)?.toDate === "function"
        ? (value as any).toDate()
        : value instanceof Date
          ? value
          : null;
    return date ? date.toLocaleDateString() : "-";
  };

  const loadInstallments = async (tenant: string, contractId: string) => {
    setInstallmentsLoading(true);
    setInstallmentsError(null);
    try {
      const list = await listInstallmentsByContract(tenant, contractId);
      setInstallments(list);
    } catch (err: any) {
      setInstallmentsError(err?.message ?? "No se pudieron cargar cuotas.");
    } finally {
      setInstallmentsLoading(false);
    }
  };

  useEffect(() => {
    if (!tenantId || !contract) return;
    loadInstallments(tenantId, contract.id);
  }, [tenantId, contract]);

  if (loading || pageLoading) {
    return <div className="text-sm text-zinc-600">Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!contract) {
    return null;
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <div className="text-sm text-zinc-500">Contrato {contract.id}</div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          {contract.property.title}
        </h1>
        <p className="text-sm text-zinc-600">{contract.property.address}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs font-semibold text-zinc-500">Locatario</div>
          <div className="text-sm font-medium text-zinc-900">
            {contract.parties.tenant.fullName}
          </div>
          <div className="text-xs text-zinc-500">
            {contract.parties.tenant.email || "Sin email"} |{" "}
            {contract.parties.tenant.whatsapp || "Sin WhatsApp"}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs font-semibold text-zinc-500">Propietario</div>
          <div className="text-sm font-medium text-zinc-900">
            {contract.parties.owner.fullName}
          </div>
          <div className="text-xs text-zinc-500">
            {contract.parties.owner.email || "Sin email"} |{" "}
            {contract.parties.owner.whatsapp || "Sin WhatsApp"}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-600">
          <div>
            <span className="font-medium text-zinc-900">Inicio:</span>{" "}
            {contract.dates.startDate}
          </div>
          <div>
            <span className="font-medium text-zinc-900">Fin:</span>{" "}
            {contract.dates.endDate}
          </div>
          <div>
            <span className="font-medium text-zinc-900">Vence:</span> dia{" "}
            {contract.dueDay}
          </div>
          <div>
            <span className="font-medium text-zinc-900">Monto:</span>{" "}
            {contract.rentAmount}
          </div>
          <div>
            <span className="font-medium text-zinc-900">Garantia:</span>{" "}
            {contract.guaranteeType}
          </div>
        </div>
        <div className="mt-3 text-sm">
          {contract.pdf?.downloadUrl ? (
            <Link
              href={contract.pdf.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-zinc-700 hover:text-zinc-900"
            >
              Ver PDF
            </Link>
          ) : (
            <span className="text-zinc-500">Sin PDF</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setTab(option.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              tab === option.key
                ? "bg-zinc-900 text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        {tab === "cuotas" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-zinc-600">
                Cuotas generadas por mes.
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!tenantId || !contract) return;
                  const ok = window.confirm(
                    "Esto creara cuotas mensuales para este contrato."
                  );
                  if (!ok) return;
                  setInstallmentsError(null);
                  setInstallmentsLoading(true);
                  try {
                    await generateInstallmentsForContract(tenantId, contract);
                    await loadInstallments(tenantId, contract.id);
                  } catch (err: any) {
                    setInstallmentsError(
                      err?.message ?? "No se pudieron generar cuotas."
                    );
                  } finally {
                    setInstallmentsLoading(false);
                  }
                }}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Generar cuotas
              </button>
            </div>
            {installmentsError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {installmentsError}
              </div>
            )}
            {installmentsLoading ? (
              <div className="text-sm text-zinc-600">Cargando cuotas...</div>
            ) : installments.length === 0 ? (
              <div className="text-sm text-zinc-600">
                Sin cuotas generadas.
              </div>
            ) : (
              <div className="space-y-2">
                {installments.map((installment) => (
                  <div
                    key={installment.id}
                    className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-700"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-zinc-900">
                        Periodo {installment.period}
                      </div>
                      <div className="text-xs text-zinc-500">
                        Vence: {formatDueDate(installment.dueDate)}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Estado: {installment.status}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-600">
                      <span>Total: {installment.totals.total}</span>
                      <span>Pagado: {installment.totals.paid}</span>
                      <span>Saldo: {installment.totals.due}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === "garantes" && (
          <div className="space-y-3">
            {contract.guarantors.map((guarantor, index) => (
              <div
                key={`${guarantor.fullName}-${index}`}
                className="rounded-lg border border-zinc-200 p-3"
              >
                <div className="text-sm font-medium text-zinc-900">
                  {guarantor.fullName}
                </div>
                <div className="text-xs text-zinc-500">
                  {guarantor.dni ? `DNI: ${guarantor.dni}` : "DNI: -"} |{" "}
                  {guarantor.address}
                </div>
                <div className="text-xs text-zinc-500">
                  {guarantor.email || "Sin email"} |{" "}
                  {guarantor.whatsapp || "Sin WhatsApp"}
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "notificaciones" && (
          <div className="text-sm text-zinc-600">
            Configuracion de notificaciones: placeholder.
          </div>
        )}
        {tab === "bitacora" && (
          <div className="text-sm text-zinc-600">Bitacora: placeholder.</div>
        )}
        {tab === "zip" && (
          <div className="text-sm text-zinc-600">Export ZIP: placeholder.</div>
        )}
      </div>

      {tenantId && (
        <div className="text-xs text-zinc-400">Tenant: {tenantId}</div>
      )}
    </section>
  );
}
