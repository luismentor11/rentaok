"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { getContract, ContractRecord } from "@/lib/db/contracts";
import {
  setInstallmentNotificationOverride,
  updateContractNotificationConfig,
  buildTenantNotificationMessage,
  getNotificationDueToday,
  getGuarantorEscalationDueToday,
  buildGuarantorNotificationMessage,
} from "@/lib/db/notifications";
import {
  generateInstallmentsForContract,
  listInstallmentItems,
  listInstallmentsByContract,
  upsertInstallmentItem,
  deleteInstallmentItem,
  addLateFeeItem,
  registerInstallmentPayment,
  markInstallmentPaidWithoutReceipt,
  InstallmentItemRecord,
  InstallmentItemType,
  InstallmentRecord,
} from "@/lib/db/installments";

const tabOptions = [
  { key: "cuotas", label: "Cuotas" },
  { key: "garantes", label: "Garantes" },
  { key: "notificaciones", label: "Notificaciones" },
  { key: "bitacora", label: "Bitacora" },
  { key: "zip", label: "Export ZIP" },
] as const;

const additionalItemTypes: { value: InstallmentItemType; label: string }[] = [
  { value: "EXPENSAS", label: "Expensas" },
  { value: "ROTURAS", label: "Roturas" },
  { value: "OTROS", label: "Otros" },
  { value: "DESCUENTO", label: "Descuento" },
];

const itemTypeLabels: Partial<Record<InstallmentItemType, string>> = {
  ALQUILER: "Alquiler",
  EXPENSAS: "Expensas",
  ROTURAS: "Roturas",
  OTROS: "Otros",
  DESCUENTO: "Descuento",
  OTRO: "Otro",
  SERVICIOS: "Servicios",
  MORA: "Mora",
  AJUSTE: "Ajuste",
};

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
  const [installmentActions, setInstallmentActions] = useState<
    Record<string, { markPaid?: boolean; notifyToggle?: boolean }>
  >({});
  const [installmentItems, setInstallmentItems] = useState<
    Record<string, InstallmentItemRecord[]>
  >({});
  const [installmentItemsLoading, setInstallmentItemsLoading] = useState<
    Record<string, boolean>
  >({});
  const [installmentItemsError, setInstallmentItemsError] = useState<
    Record<string, string | null>
  >({});
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentInstallment, setPaymentInstallment] =
    useState<InstallmentRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentWithoutReceipt, setPaymentWithoutReceipt] = useState(false);
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemInstallment, setItemInstallment] =
    useState<InstallmentRecord | null>(null);
  const [itemEditing, setItemEditing] = useState<InstallmentItemRecord | null>(
    null
  );
  const [itemType, setItemType] =
    useState<InstallmentItemType>("EXPENSAS");
  const [itemLabel, setItemLabel] = useState("");
  const [itemAmount, setItemAmount] = useState("");
  const [itemSubmitting, setItemSubmitting] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [lateFeeModalOpen, setLateFeeModalOpen] = useState(false);
  const [lateFeeInstallment, setLateFeeInstallment] =
    useState<InstallmentRecord | null>(null);
  const [lateFeeAmount, setLateFeeAmount] = useState("");
  const [lateFeeSubmitting, setLateFeeSubmitting] = useState(false);
  const [lateFeeError, setLateFeeError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("cuotas");
  const [contractNotificationSaving, setContractNotificationSaving] =
    useState(false);
  const [contractNotificationError, setContractNotificationError] = useState<
    string | null
  >(null);

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

  const loadInstallmentItems = async (tenant: string, installmentId: string) => {
    setInstallmentItemsLoading((prev) => ({ ...prev, [installmentId]: true }));
    setInstallmentItemsError((prev) => ({ ...prev, [installmentId]: null }));
    try {
      const list = await listInstallmentItems(tenant, installmentId);
      setInstallmentItems((prev) => ({ ...prev, [installmentId]: list }));
    } catch (err: any) {
      setInstallmentItemsError((prev) => ({
        ...prev,
        [installmentId]: err?.message ?? "No se pudieron cargar items.",
      }));
    } finally {
      setInstallmentItemsLoading((prev) => ({ ...prev, [installmentId]: false }));
    }
  };

  const ensureInstallmentItems = async (
    tenant: string,
    installmentId: string
  ) => {
    if (installmentItems[installmentId]) return;
    await loadInstallmentItems(tenant, installmentId);
  };

  const openPaymentModal = (installment: InstallmentRecord) => {
    setPaymentInstallment(installment);
    setPaymentAmount("");
    setPaymentWithoutReceipt(false);
    setPaymentNote("");
    setPaymentError(null);
    setPaymentModalOpen(true);
  };

  const closePaymentModal = () => {
    if (paymentSubmitting) return;
    setPaymentModalOpen(false);
    setPaymentInstallment(null);
  };

  const openItemModal = async (
    installment: InstallmentRecord,
    item?: InstallmentItemRecord
  ) => {
    if (!tenantId) return;
    await ensureInstallmentItems(tenantId, installment.id);
    setItemInstallment(installment);
    setItemEditing(item ?? null);
    setItemType(item?.type ?? "EXPENSAS");
    setItemLabel(item?.label ?? "");
    setItemAmount(item ? String(item.amount) : "");
    setItemError(null);
    setItemModalOpen(true);
  };

  const closeItemModal = () => {
    if (itemSubmitting) return;
    setItemModalOpen(false);
    setItemInstallment(null);
    setItemEditing(null);
  };

  const openLateFeeModal = (installment: InstallmentRecord) => {
    setLateFeeInstallment(installment);
    setLateFeeAmount("");
    setLateFeeError(null);
    setLateFeeModalOpen(true);
  };

  const closeLateFeeModal = () => {
    if (lateFeeSubmitting) return;
    setLateFeeModalOpen(false);
    setLateFeeInstallment(null);
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

  const tenantEmail = contract.parties.tenant.email?.trim();
  const tenantWhatsapp = contract.parties.tenant.whatsapp?.trim();
  const contractNotificationsEnabled = Boolean(contract.notificationConfig?.enabled);

  const saveContractNotificationConfig = async (nextEnabled: boolean) => {
    if (!tenantId) return;
    setContractNotificationSaving(true);
    setContractNotificationError(null);
    try {
      await updateContractNotificationConfig(tenantId, contract.id, nextEnabled);
      setContract((prev) =>
        prev
          ? {
              ...prev,
              notificationConfig: {
                enabled: nextEnabled,
                emailRecipients: tenantEmail ? [tenantEmail] : [],
                whatsappRecipients: tenantWhatsapp ? [tenantWhatsapp] : [],
              },
            }
          : prev
      );
    } catch (err: any) {
      setContractNotificationError(
        err?.message ?? "No se pudo guardar la configuracion."
      );
    } finally {
      setContractNotificationSaving(false);
    }
  };

  const todayDate = new Date();
  const notificationsDueToday = contractNotificationsEnabled
    ? installments
        .map((installment) => {
          if (installment.status === "PAGADA") return null;
          if (installment.notificationOverride?.enabled === false) return null;
          const dueType = getNotificationDueToday(installment, todayDate);
          if (!dueType) return null;
          const message = buildTenantNotificationMessage({
            installment,
            contractId: contract.id,
            dueType,
          });
          return { installment, dueType, message };
        })
        .filter(
          (
            item
          ): item is {
            installment: InstallmentRecord;
            dueType: "PRE_DUE_5" | "POST_DUE_1";
            message: { subject: string; body: string; whatsappText: string };
          } => item !== null
        )
    : [];

  const guarantorNotificationsDueToday = contractNotificationsEnabled
    ? installments
        .map((installment) => {
          if (installment.status === "PAGADA") return null;
          if (installment.status === "EN_ACUERDO") return null;
          if (installment.notificationOverride?.enabled === false) return null;
          if (!getGuarantorEscalationDueToday(installment, todayDate)) {
            return null;
          }
          const message = buildGuarantorNotificationMessage({
            installment,
            contractId: contract.id,
          });
          return { installment, message };
        })
        .filter(
          (
            item
          ): item is {
            installment: InstallmentRecord;
            message: { subject: string; body: string; whatsappText: string };
          } => item !== null
        )
    : [];

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <div className="text-sm text-zinc-500">Contrato {contract.id}</div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          {contract.propertyTitle ||
            (contract as any)?.property?.title ||
            "-"}
        </h1>
        <p className="text-sm text-zinc-600">
          {contract.propertyAddress ||
            (contract as any)?.property?.address ||
            "-"}
        </p>
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
                {installments.map((installment) => {
                  const overrideEnabled = installment.notificationOverride?.enabled;
                  const hasOverride = overrideEnabled !== undefined;
                  const notifyEnabled = hasOverride
                    ? overrideEnabled
                    : contractNotificationsEnabled;
                  const notifyDisabled =
                    installmentActions[installment.id]?.notifyToggle ||
                    (!contractNotificationsEnabled && !hasOverride);

                  return (
                    <div
                    key={installment.id}
                    className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-700"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-medium text-zinc-900">
                        <span>Periodo {installment.period}</span>
                        {hasOverride && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            Override
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">
                        Vence: {formatDueDate(installment.dueDate)}
                      </div>
                    </div>
                    {installment.paymentFlags?.hasUnverifiedPayments && (
                      <div className="mt-1 text-xs font-semibold text-amber-600">
                        Pago sin comprobante
                      </div>
                    )}
                    <div className="mt-1 text-xs text-zinc-500">
                      Estado: {installment.status}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-600">
                      <span>Total: {installment.totals.total}</span>
                      <span>Pagado: {installment.totals.paid}</span>
                      <span>Saldo: {installment.totals.due}</span>
                    </div>
                    <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-zinc-700">
                            Notificaciones
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {hasOverride
                              ? "Override activo para esta cuota."
                              : "Heredando configuracion del contrato."}
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-zinc-600">
                          <input
                            type="checkbox"
                            checked={Boolean(notifyEnabled)}
                            disabled={notifyDisabled}
                            onChange={async () => {
                              if (!tenantId) return;
                              if (!contractNotificationsEnabled && !hasOverride) {
                                return;
                              }
                              setInstallmentActions((prev) => ({
                                ...prev,
                                [installment.id]: {
                                  ...prev[installment.id],
                                  notifyToggle: true,
                                },
                              }));
                              setInstallmentsError(null);
                              try {
                                await setInstallmentNotificationOverride(
                                  tenantId,
                                  installment.id,
                                  hasOverride ? null : false
                                );
                                await loadInstallments(
                                  tenantId,
                                  installment.contractId
                                );
                              } catch (err: any) {
                                setInstallmentsError(
                                  err?.message ??
                                    "No se pudo actualizar la notificacion."
                                );
                              } finally {
                                setInstallmentActions((prev) => ({
                                  ...prev,
                                  [installment.id]: {
                                    ...prev[installment.id],
                                    notifyToggle: false,
                                  },
                                }));
                              }
                            }}
                          />
                          Notificar esta cuota
                        </label>
                      </div>
                      {!contractNotificationsEnabled && !hasOverride && (
                        <div className="mt-1 text-[11px] text-zinc-500">
                          El contrato tiene notificaciones desactivadas.
                        </div>
                      )}
                    </div>
                    <div className="mt-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openPaymentModal(installment)}
                          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                          Registrar pago
                        </button>
                        <button
                          type="button"
                          onClick={() => openLateFeeModal(installment)}
                          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                          Agregar mora
                        </button>
                        <button
                          type="button"
                          disabled={installmentActions[installment.id]?.markPaid}
                          onClick={async () => {
                            if (!tenantId) return;
                            const ok = window.confirm(
                              "Esto marca la cuota como PAGADA sin comprobante. ¿Continuar?"
                            );
                            if (!ok) return;
                            setInstallmentActions((prev) => ({
                              ...prev,
                              [installment.id]: {
                                ...prev[installment.id],
                                markPaid: true,
                              },
                            }));
                            setInstallmentsError(null);
                            try {
                              await markInstallmentPaidWithoutReceipt(
                                tenantId,
                                installment.id
                              );
                              await loadInstallments(
                                tenantId,
                                installment.contractId
                              );
                            } catch (err: any) {
                              setInstallmentsError(
                                err?.message ??
                                  "No se pudo marcar como pagada."
                              );
                            } finally {
                              setInstallmentActions((prev) => ({
                                ...prev,
                                [installment.id]: {
                                  ...prev[installment.id],
                                  markPaid: false,
                                },
                              }));
                            }
                          }}
                          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed"
                        >
                          {installmentActions[installment.id]?.markPaid
                            ? "Marcando..."
                            : "Marcar pagada (sin comprobante)"}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-zinc-700">
                        <span>Adicionales</span>
                        <button
                          type="button"
                          onClick={() => openItemModal(installment)}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                          Agregar adicional
                        </button>
                      </div>
                      {installmentItemsError[installment.id] && (
                        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                          {installmentItemsError[installment.id]}
                        </div>
                      )}
                      {installmentItemsLoading[installment.id] ? (
                        <div className="mt-2 text-xs text-zinc-500">
                          Cargando items...
                        </div>
                      ) : installmentItems[installment.id] ? (
                        installmentItems[installment.id].length === 0 ? (
                          <div className="mt-2 text-xs text-zinc-500">
                            Sin items registrados.
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2 text-xs text-zinc-600">
                            {installmentItems[installment.id].map((item) => (
                              <div
                                key={item.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-2 py-1"
                              >
                                <div>
                                  <div className="font-medium text-zinc-800">
                                    {itemTypeLabels[item.type] ?? item.type}
                                  </div>
                                  <div className="text-[11px] text-zinc-500">
                                    {item.label}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-zinc-700">
                                    {item.amount}
                                  </span>
                                  {item.type !== "ALQUILER" && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => openItemModal(installment, item)}
                                        className="text-[11px] text-zinc-600 hover:text-zinc-900"
                                      >
                                        Editar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          if (!tenantId) return;
                                          const ok = window.confirm(
                                            "Eliminar este item?"
                                          );
                                          if (!ok) return;
                                          setInstallmentItemsError((prev) => ({
                                            ...prev,
                                            [installment.id]: null,
                                          }));
                                          try {
                                            await deleteInstallmentItem(
                                              tenantId,
                                              installment.id,
                                              item.id
                                            );
                                            await loadInstallmentItems(
                                              tenantId,
                                              installment.id
                                            );
                                            await loadInstallments(
                                              tenantId,
                                              installment.contractId
                                            );
                                          } catch (err: any) {
                                            setInstallmentItemsError((prev) => ({
                                              ...prev,
                                              [installment.id]:
                                                err?.message ??
                                                "No se pudo borrar el item.",
                                            }));
                                          }
                                        }}
                                        className="text-[11px] text-red-600 hover:text-red-700"
                                      >
                                        Eliminar
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      ) : (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => tenantId && loadInstallmentItems(tenantId, installment.id)}
                            className="text-[11px] font-medium text-zinc-600 hover:text-zinc-900"
                          >
                            Cargar items
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
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
          <div className="space-y-4 text-sm text-zinc-600">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-zinc-900">
                  Activar notificaciones (solo inquilino)
                </div>
                <div className="text-xs text-zinc-500">
                  Se aplica a todas las cuotas salvo override.
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={contractNotificationsEnabled}
                  disabled={contractNotificationSaving}
                  onChange={(event) =>
                    saveContractNotificationConfig(event.target.checked)
                  }
                />
                {contractNotificationSaving
                  ? "Guardando..."
                  : contractNotificationsEnabled
                    ? "Activo"
                    : "Inactivo"}
              </label>
            </div>
            {contractNotificationError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {contractNotificationError}
              </div>
            )}
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div className="text-xs font-semibold text-zinc-500">
                Destinatarios detectados
              </div>
              <div className="mt-2 text-xs text-zinc-600">
                Email: {tenantEmail || "(sin email)"}
              </div>
              <div className="text-xs text-zinc-600">
                WhatsApp: {tenantWhatsapp || "(sin whatsapp)"}
              </div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-white p-3">
              <div className="text-xs font-semibold text-zinc-700">
                Para enviar hoy
              </div>
              {!contractNotificationsEnabled ? (
                <div className="mt-2 text-xs text-zinc-500">
                  El contrato tiene notificaciones desactivadas.
                </div>
              ) : notificationsDueToday.length === 0 ? (
                <div className="mt-2 text-xs text-zinc-500">
                  Sin cuotas para notificar hoy.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {notificationsDueToday.map(({ installment, dueType, message }) => {
                    const label =
                      dueType === "PRE_DUE_5" ? "5 dias antes" : "1 dia despues";
                    const whatsappNumber = tenantWhatsapp
                      ? tenantWhatsapp.replace(/\D/g, "")
                      : "";
                    const emailHref = tenantEmail
                      ? `mailto:${tenantEmail}?subject=${encodeURIComponent(
                          message.subject
                        )}&body=${encodeURIComponent(message.body)}`
                      : "";
                    const whatsappHref = whatsappNumber
                      ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
                          message.whatsappText
                        )}`
                      : "";

                    return (
                      <div
                        key={`${installment.id}-${dueType}`}
                        className="rounded-md border border-zinc-200 p-3 text-xs text-zinc-600"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-zinc-900">
                            Periodo {installment.period}
                          </div>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            {label}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500">
                          Vence: {formatDueDate(installment.dueDate)} | Estado:{" "}
                          {installment.status}
                        </div>
                        <details className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1">
                          <summary className="cursor-pointer text-[11px] font-medium text-zinc-600">
                            Preview del mensaje
                          </summary>
                          <div className="mt-2 space-y-2 text-[11px] text-zinc-600">
                            <div>
                              <div className="font-semibold text-zinc-700">
                                Email
                              </div>
                              <div className="whitespace-pre-wrap">
                                Asunto: {message.subject}
                                {"\n\n"}
                                {message.body}
                              </div>
                            </div>
                            <div>
                              <div className="font-semibold text-zinc-700">
                                WhatsApp
                              </div>
                              <div className="whitespace-pre-wrap">
                                {message.whatsappText}
                              </div>
                            </div>
                          </div>
                        </details>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {whatsappNumber ? (
                            <a
                              href={whatsappHref}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                            >
                              WhatsApp
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-400"
                            >
                              WhatsApp (sin numero)
                            </button>
                          )}
                          {tenantEmail ? (
                            <a
                              href={emailHref}
                              className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                            >
                              Email
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-400"
                            >
                              Email (sin email)
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="rounded-md border border-zinc-200 bg-white p-3">
              <div className="text-xs font-semibold text-zinc-700">
                Escalamiento a garantes (dia +5)
              </div>
              {!contractNotificationsEnabled ? (
                <div className="mt-2 text-xs text-zinc-500">
                  El contrato tiene notificaciones desactivadas.
                </div>
              ) : contract.guarantors.length === 0 ? (
                <div className="mt-2 text-xs text-zinc-500">(sin garantes)</div>
              ) : guarantorNotificationsDueToday.length === 0 ? (
                <div className="mt-2 text-xs text-zinc-500">
                  Sin cuotas para escalar hoy.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {guarantorNotificationsDueToday.map(
                    ({ installment, message }) => (
                      <div
                        key={`${installment.id}-guarantor`}
                        className="rounded-md border border-zinc-200 p-3 text-xs text-zinc-600"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-zinc-900">
                            Periodo {installment.period}
                          </div>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            dia +5
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500">
                          Vence: {formatDueDate(installment.dueDate)} | Estado:{" "}
                          {installment.status}
                        </div>
                        <details className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1">
                          <summary className="cursor-pointer text-[11px] font-medium text-zinc-600">
                            Preview del mensaje
                          </summary>
                          <div className="mt-2 space-y-2 text-[11px] text-zinc-600">
                            <div>
                              <div className="font-semibold text-zinc-700">
                                Email
                              </div>
                              <div className="whitespace-pre-wrap">
                                Asunto: {message.subject}
                                {"\n\n"}
                                {message.body}
                              </div>
                            </div>
                            <div>
                              <div className="font-semibold text-zinc-700">
                                WhatsApp
                              </div>
                              <div className="whitespace-pre-wrap">
                                {message.whatsappText}
                              </div>
                            </div>
                          </div>
                        </details>
                        <div className="mt-3 space-y-2">
                          {contract.guarantors.map((guarantor, index) => {
                            const guarantorEmail = guarantor.email?.trim();
                            const guarantorWhatsapp = guarantor.whatsapp?.trim();
                            const whatsappNumber = guarantorWhatsapp
                              ? guarantorWhatsapp.replace(/\D/g, "")
                              : "";
                            const emailHref = guarantorEmail
                              ? `mailto:${guarantorEmail}?subject=${encodeURIComponent(
                                  message.subject
                                )}&body=${encodeURIComponent(message.body)}`
                              : "";
                            const whatsappHref = whatsappNumber
                              ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
                                  message.whatsappText
                                )}`
                              : "";

                            return (
                              <div
                                key={`${installment.id}-${index}`}
                                className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2"
                              >
                                <div className="text-[11px] font-semibold text-zinc-700">
                                  {guarantor.fullName}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {whatsappNumber ? (
                                    <a
                                      href={whatsappHref}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                                    >
                                      WhatsApp
                                    </a>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled
                                      className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-400"
                                    >
                                      WhatsApp (sin numero)
                                    </button>
                                  )}
                                  {guarantorEmail ? (
                                    <a
                                      href={emailHref}
                                      className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                                    >
                                      Email
                                    </a>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled
                                      className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-400"
                                    >
                                      Email (sin email)
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
            <div className="text-xs text-zinc-500">
              v1: solo inquilino. No se permiten destinatarios manuales.
            </div>
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

      {paymentModalOpen && paymentInstallment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                Registrar pago
              </h3>
              <button
                type="button"
                onClick={closePaymentModal}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Periodo {paymentInstallment.period} - Total{" "}
              {paymentInstallment.totals.total}
            </p>
            {paymentError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {paymentError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Monto pagado
                </label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  placeholder="1000"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={paymentWithoutReceipt}
                  onChange={(event) =>
                    setPaymentWithoutReceipt(event.target.checked)
                  }
                />
                Sin comprobante
              </label>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Nota (opcional)
                </label>
                <input
                  type="text"
                  value={paymentNote}
                  onChange={(event) => setPaymentNote(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  placeholder="Pago en efectivo"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closePaymentModal}
                disabled={paymentSubmitting}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={paymentSubmitting}
                onClick={async () => {
                  if (!tenantId || !paymentInstallment) return;
                  const amountValue = Number(paymentAmount);
                  if (!Number.isFinite(amountValue) || amountValue <= 0) {
                    setPaymentError("El monto debe ser mayor a 0.");
                    return;
                  }
                  setPaymentSubmitting(true);
                  setPaymentError(null);
                  try {
                    await registerInstallmentPayment(
                      tenantId,
                      paymentInstallment.id,
                      {
                        amount: amountValue,
                        withoutReceipt: paymentWithoutReceipt,
                        note: paymentNote || undefined,
                      }
                    );
                    await loadInstallments(tenantId, paymentInstallment.contractId);
                    setPaymentModalOpen(false);
                    setPaymentInstallment(null);
                  } catch (err: any) {
                    setPaymentError(
                      err?.message ?? "No se pudo registrar el pago."
                    );
                  } finally {
                    setPaymentSubmitting(false);
                  }
                }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {paymentSubmitting ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {itemModalOpen && itemInstallment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                {itemEditing ? "Editar item" : "Agregar adicional"}
              </h3>
              <button
                type="button"
                onClick={closeItemModal}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Periodo {itemInstallment.period}
            </p>
            {itemError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {itemError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Tipo
                </label>
                <select
                  value={itemType}
                  onChange={(event) =>
                    setItemType(event.target.value as InstallmentItemType)
                  }
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                >
                  {additionalItemTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Concepto
                </label>
                <input
                  type="text"
                  value={itemLabel}
                  onChange={(event) => setItemLabel(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  placeholder="Ej: Expensas marzo"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Monto
                </label>
                <input
                  type="number"
                  value={itemAmount}
                  onChange={(event) => setItemAmount(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  placeholder="1000"
                />
                {itemType === "DESCUENTO" && (
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Se guarda como monto negativo.
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeItemModal}
                disabled={itemSubmitting}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={itemSubmitting}
                onClick={async () => {
                  if (!tenantId || !itemInstallment) return;
                  const labelValue = itemLabel.trim();
                  if (!labelValue) {
                    setItemError("El concepto es obligatorio.");
                    return;
                  }
                  let amountValue = Number(itemAmount);
                  if (!Number.isFinite(amountValue) || amountValue === 0) {
                    setItemError("El monto debe ser distinto de 0.");
                    return;
                  }
                  if (itemType === "DESCUENTO" && amountValue > 0) {
                    amountValue = -amountValue;
                  }
                  if (itemType !== "DESCUENTO" && amountValue <= 0) {
                    setItemError("El monto debe ser mayor a 0.");
                    return;
                  }
                  setItemSubmitting(true);
                  setItemError(null);
                  try {
                    await upsertInstallmentItem(
                      tenantId,
                      itemInstallment.id,
                      {
                        id: itemEditing?.id,
                        type: itemType,
                        label: labelValue,
                        amount: amountValue,
                      }
                    );
                    await loadInstallmentItems(tenantId, itemInstallment.id);
                    await loadInstallments(tenantId, itemInstallment.contractId);
                    setItemModalOpen(false);
                    setItemInstallment(null);
                    setItemEditing(null);
                  } catch (err: any) {
                    setItemError(
                      err?.message ?? "No se pudo guardar el item."
                    );
                  } finally {
                    setItemSubmitting(false);
                  }
                }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {itemSubmitting ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {lateFeeModalOpen && lateFeeInstallment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                Agregar mora
              </h3>
              <button
                type="button"
                onClick={closeLateFeeModal}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Periodo {lateFeeInstallment.period}
            </p>
            {lateFeeError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {lateFeeError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Monto
                </label>
                <input
                  type="number"
                  value={lateFeeAmount}
                  onChange={(event) => setLateFeeAmount(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  placeholder="3000"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeLateFeeModal}
                disabled={lateFeeSubmitting}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={lateFeeSubmitting}
                onClick={async () => {
                  if (!tenantId || !lateFeeInstallment) return;
                  const amountValue = Number(lateFeeAmount);
                  if (!Number.isFinite(amountValue) || amountValue <= 0) {
                    setLateFeeError("El monto debe ser mayor a 0.");
                    return;
                  }
                  setLateFeeSubmitting(true);
                  setLateFeeError(null);
                  try {
                    await addLateFeeItem(
                      tenantId,
                      lateFeeInstallment.id,
                      amountValue
                    );
                    await loadInstallmentItems(
                      tenantId,
                      lateFeeInstallment.id
                    );
                    await loadInstallments(
                      tenantId,
                      lateFeeInstallment.contractId
                    );
                    setLateFeeModalOpen(false);
                    setLateFeeInstallment(null);
                  } catch (err: any) {
                    setLateFeeError(
                      err?.message ?? "No se pudo agregar la mora."
                    );
                  } finally {
                    setLateFeeSubmitting(false);
                  }
                }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {lateFeeSubmitting ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
