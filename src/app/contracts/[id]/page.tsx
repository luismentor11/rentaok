"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
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
  logNotificationSent,
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
  PaymentMethod,
} from "@/lib/db/installments";
import { uploadPaymentReceipt } from "@/lib/storage/payments";
import {
  addContractEvent,
  listContractEvents,
  updateContractEventAttachments,
  uploadEventAttachment,
  EventRecord,
  ContractEventType,
} from "@/lib/db/events";
import { exportContractZip } from "@/lib/export/exportContractZip";
import { toDateSafe } from "@/lib/utils/firestoreDate";
import { db } from "@/lib/firebase";

const tabOptions = [
  { key: "resumen", label: "Resumen" },
  { key: "partes", label: "Partes" },
  { key: "pagos", label: "Pagos" },
  { key: "documentos", label: "Documentos" },
  { key: "alertas", label: "Alertas" },
  { key: "actividad", label: "Actividad" },
] as const;

const additionalItemTypes: { value: InstallmentItemType; label: string }[] = [
  { value: "EXPENSAS", label: "Expensas" },
  { value: "ROTURAS", label: "Roturas" },
  { value: "OTROS", label: "Otros" },
  { value: "DESCUENTO", label: "Descuento" },
];

const eventTypeOptions: { value: ContractEventType; label: string }[] = [
  { value: "MENSAJE", label: "Mensaje" },
  { value: "LLAMADA", label: "Llamada" },
  { value: "RECLAMO", label: "Reclamo" },
  { value: "DAÑO", label: "Dano" },
  { value: "ACUERDO", label: "Acuerdo" },
  { value: "OTRO", label: "Otro" },
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

type ContractRecordWithProperty = ContractRecord & {
  property?: {
    title?: string;
    address?: string;
  };
};

type NotificationLogEntry = {
  type: string;
  at: Date | string;
  channel?: string;
  message?: string;
};

export default function ContractDetailPage({ params }: PageProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [contract, setContract] = useState<ContractRecordWithProperty | null>(
    null
  );
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
  const [contractEvents, setContractEvents] = useState<EventRecord[]>([]);
  const [contractEventsLoading, setContractEventsLoading] = useState(false);
  const [contractEventsError, setContractEventsError] = useState<string | null>(
    null
  );
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentInstallment, setPaymentInstallment] =
    useState<InstallmentRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentPaidAt, setPaymentPaidAt] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("EFECTIVO");
  const [paymentWithoutReceipt, setPaymentWithoutReceipt] = useState(false);
  const [paymentReceiptFile, setPaymentReceiptFile] = useState<File | null>(null);
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [eventType, setEventType] = useState<ContractEventType>("MENSAJE");
  const [eventAt, setEventAt] = useState("");
  const [eventDetail, setEventDetail] = useState("");
  const [eventTags, setEventTags] = useState("");
  const [eventInstallmentId, setEventInstallmentId] = useState("");
  const [eventAttachments, setEventAttachments] = useState<File[]>([]);
  const [eventAttachmentsKey, setEventAttachmentsKey] = useState(0);
  const [eventSubmitting, setEventSubmitting] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
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
  const [tab, setTab] = useState<TabKey>("resumen");
  const [contractNotificationSaving, setContractNotificationSaving] =
    useState(false);
  const [contractNotificationError, setContractNotificationError] = useState<
    string | null
  >(null);
  const [notificationSendError, setNotificationSendError] = useState<
    string | null
  >(null);
  const [exportingZip, setExportingZip] = useState(false);
  const [exportZipError, setExportZipError] = useState<string | null>(null);
  const [exportZipSuccess, setExportZipSuccess] = useState<string | null>(null);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [messageRecipient, setMessageRecipient] = useState<
    "tenant" | "guarantors" | "both"
  >("tenant");
  const [messageChannel, setMessageChannel] = useState<
    "whatsapp" | "email" | "copy"
  >("whatsapp");
  const [messageText, setMessageText] = useState("");
  const [messageSubmitting, setMessageSubmitting] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

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
    const date = toDateSafe(value);
    return date ? date.toLocaleDateString() : "-";
  };

  const formatEventAt = (value: EventRecord["at"]) => {
    const date = toDateSafe(value);
    return date ? date.toLocaleString() : "-";
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

  const loadContractEvents = async (tenant: string, contractId: string) => {
    setContractEventsLoading(true);
    setContractEventsError(null);
    try {
      const list = await listContractEvents(tenant, contractId);
      setContractEvents(list);
    } catch (err: any) {
      setContractEventsError(
        err?.message ?? "No se pudieron cargar eventos."
      );
    } finally {
      setContractEventsLoading(false);
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
    setPaymentPaidAt(toDateTimeInputValue(new Date()));
    setPaymentMethod("EFECTIVO");
    setPaymentWithoutReceipt(false);
    setPaymentReceiptFile(null);
    setPaymentNote("");
    setPaymentError(null);
    setPaymentModalOpen(true);
  };

  const closePaymentModal = () => {
    if (paymentSubmitting) return;
    setPaymentModalOpen(false);
    setPaymentInstallment(null);
  };

  const resetEventForm = () => {
    setEventType("MENSAJE");
    setEventAt(toDateTimeInputValue(new Date()));
    setEventDetail("");
    setEventTags("");
    setEventInstallmentId("");
    setEventAttachments([]);
    setEventAttachmentsKey((prev) => prev + 1);
    setEventError(null);
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

  const openMessageModal = () => {
    setMessageRecipient("tenant");
    setMessageChannel("whatsapp");
    setMessageText("");
    setMessageError(null);
    setMessageModalOpen(true);
  };

  const closeMessageModal = () => {
    if (messageSubmitting) return;
    setMessageModalOpen(false);
  };

  useEffect(() => {
    if (!tenantId || !contract) return;
    loadInstallments(tenantId, contract.id);
    loadContractEvents(tenantId, contract.id);
    resetEventForm();
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
        <div>No se pudo cargar el contrato.</div>
        <Link
          href="/contracts"
          className="mt-2 inline-flex text-xs font-medium text-red-700 hover:text-red-900"
        >
          Volver a contratos
        </Link>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        <div>Contrato no encontrado.</div>
        <Link
          href="/contracts"
          className="mt-2 inline-flex text-xs font-medium text-red-700 hover:text-red-900"
        >
          Volver a contratos
        </Link>
      </div>
    );
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

  const formatDayKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;

  const toDateTimeInputValue = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const parseTags = (value: string) =>
    value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

  const hasNotificationSent = (params: {
    installment: InstallmentRecord;
    type: "PRE_DUE_5" | "POST_DUE_1" | "GUARANTOR_DUE_5";
    channel: "whatsapp" | "email";
    audience: "TENANT" | "GUARANTOR";
    recipient: string;
    dayKey: string;
  }) => {
    const logEntries = (params.installment as {
      notificationLog?: NotificationLogEntry[];
    }).notificationLog;
    if (!Array.isArray(logEntries)) return false;
    return logEntries.some(
      (item: any) =>
        item?.dayKey === params.dayKey &&
        item?.type === params.type &&
        item?.channel === params.channel &&
        item?.audience === params.audience &&
        item?.recipient === params.recipient
    );
  };

  const todayDate = new Date();
  const todayDayKey = formatDayKey(todayDate);
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

  const installmentLabelById = new Map(
    installments.map((installment) => [
      installment.id,
      `Periodo ${installment.period}`,
    ])
  );

  return (
    <section className="space-y-6">
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
        {tab === "resumen" && (
          <div className="space-y-6">
            <div className="space-y-1">
              <div className="text-sm text-zinc-500">Contrato {contract.id}</div>
              <h1 className="text-2xl font-semibold text-zinc-900">
                {contract.property?.title || "-"}
              </h1>
              <p className="text-sm text-zinc-600">
                {contract.property?.address || "-"}
              </p>
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
          </div>
        )}
        {tab === "partes" && (
          <div className="space-y-4">
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
          </div>
        )}
        {tab === "pagos" && (
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
                            if (!user?.uid) {
                              setInstallmentsError(
                                "No se pudo obtener el usuario."
                              );
                              return;
                            }
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
                                installment.id,
                                user.uid
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
        {tab === "alertas" && (
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
            {notificationSendError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {notificationSendError}
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
                    const tenantEmailSent = tenantEmail
                      ? hasNotificationSent({
                          installment,
                          type: dueType,
                          channel: "email",
                          audience: "TENANT",
                          recipient: tenantEmail,
                          dayKey: todayDayKey,
                        })
                      : false;
                    const tenantWhatsappSent = whatsappNumber
                      ? hasNotificationSent({
                          installment,
                          type: dueType,
                          channel: "whatsapp",
                          audience: "TENANT",
                          recipient: whatsappNumber,
                          dayKey: todayDayKey,
                        })
                      : false;

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
                          <div className="flex flex-wrap items-center gap-2">
                            {whatsappNumber ? (
                              <button
                                type="button"
                                disabled={tenantWhatsappSent}
                                onClick={async () => {
                                  if (!tenantId) return;
                                  if (tenantWhatsappSent) return;
                                  setNotificationSendError(null);
                                  try {
                                    await logNotificationSent(
                                      tenantId,
                                      installment.id,
                                      {
                                        type: dueType,
                                        channel: "whatsapp",
                                        audience: "TENANT",
                                        recipient: whatsappNumber,
                                      }
                                    );
                                    window.open(
                                      whatsappHref,
                                      "_blank",
                                      "noopener,noreferrer"
                                    );
                                    await loadInstallments(
                                      tenantId,
                                      installment.contractId
                                    );
                                  } catch (err: any) {
                                    setNotificationSendError(
                                      err?.message ??
                                        "No se pudo registrar el envio."
                                    );
                                  }
                                }}
                                className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:text-zinc-400"
                              >
                                WhatsApp
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-400"
                              >
                                WhatsApp (sin numero)
                              </button>
                            )}
                            {tenantWhatsappSent && (
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                                Ya enviado hoy
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {tenantEmail ? (
                              <button
                                type="button"
                                disabled={tenantEmailSent}
                                onClick={async () => {
                                  if (!tenantId) return;
                                  if (tenantEmailSent) return;
                                  setNotificationSendError(null);
                                  try {
                                    await logNotificationSent(
                                      tenantId,
                                      installment.id,
                                      {
                                        type: dueType,
                                        channel: "email",
                                        audience: "TENANT",
                                        recipient: tenantEmail,
                                      }
                                    );
                                    window.open(emailHref, "_blank");
                                    await loadInstallments(
                                      tenantId,
                                      installment.contractId
                                    );
                                  } catch (err: any) {
                                    setNotificationSendError(
                                      err?.message ??
                                        "No se pudo registrar el envio."
                                    );
                                  }
                                }}
                                className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:text-zinc-400"
                              >
                                Email
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-400"
                              >
                                Email (sin email)
                              </button>
                            )}
                            {tenantEmailSent && (
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                                Ya enviado hoy
                              </span>
                            )}
                          </div>
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
                            const guarantorEmailSent = guarantorEmail
                              ? hasNotificationSent({
                                  installment,
                                  type: "GUARANTOR_DUE_5",
                                  channel: "email",
                                  audience: "GUARANTOR",
                                  recipient: guarantorEmail,
                                  dayKey: todayDayKey,
                                })
                              : false;
                            const guarantorWhatsappSent = whatsappNumber
                              ? hasNotificationSent({
                                  installment,
                                  type: "GUARANTOR_DUE_5",
                                  channel: "whatsapp",
                                  audience: "GUARANTOR",
                                  recipient: whatsappNumber,
                                  dayKey: todayDayKey,
                                })
                              : false;

                            return (
                              <div
                                key={`${installment.id}-${index}`}
                                className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2"
                              >
                                <div className="text-[11px] font-semibold text-zinc-700">
                                  {guarantor.fullName}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    {whatsappNumber ? (
                                      <button
                                        type="button"
                                        disabled={guarantorWhatsappSent}
                                        onClick={async () => {
                                          if (!tenantId) return;
                                          if (guarantorWhatsappSent) return;
                                          setNotificationSendError(null);
                                          try {
                                            await logNotificationSent(
                                              tenantId,
                                              installment.id,
                                              {
                                                type: "GUARANTOR_DUE_5",
                                                channel: "whatsapp",
                                                audience: "GUARANTOR",
                                                recipient: whatsappNumber,
                                              }
                                            );
                                            window.open(
                                              whatsappHref,
                                              "_blank",
                                              "noopener,noreferrer"
                                            );
                                            await loadInstallments(
                                              tenantId,
                                              installment.contractId
                                            );
                                          } catch (err: any) {
                                            setNotificationSendError(
                                              err?.message ??
                                                "No se pudo registrar el envio."
                                            );
                                          }
                                        }}
                                        className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:text-zinc-400"
                                      >
                                        WhatsApp
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled
                                        className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-400"
                                      >
                                        WhatsApp (sin numero)
                                      </button>
                                    )}
                                    {guarantorWhatsappSent && (
                                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                                        Ya enviado hoy
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {guarantorEmail ? (
                                      <button
                                        type="button"
                                        disabled={guarantorEmailSent}
                                        onClick={async () => {
                                          if (!tenantId) return;
                                          if (guarantorEmailSent) return;
                                          setNotificationSendError(null);
                                          try {
                                            await logNotificationSent(
                                              tenantId,
                                              installment.id,
                                              {
                                                type: "GUARANTOR_DUE_5",
                                                channel: "email",
                                                audience: "GUARANTOR",
                                                recipient: guarantorEmail,
                                              }
                                            );
                                            window.open(emailHref, "_blank");
                                            await loadInstallments(
                                              tenantId,
                                              installment.contractId
                                            );
                                          } catch (err: any) {
                                            setNotificationSendError(
                                              err?.message ??
                                                "No se pudo registrar el envio."
                                            );
                                          }
                                        }}
                                        className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:text-zinc-400"
                                      >
                                        Email
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled
                                        className="rounded-md border border-zinc-200 px-3 py-1.5 text-[11px] font-medium text-zinc-400"
                                      >
                                        Email (sin email)
                                      </button>
                                    )}
                                    {guarantorEmailSent && (
                                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                                        Ya enviado hoy
                                      </span>
                                    )}
                                  </div>
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
        {tab === "actividad" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-900">
                  Nuevo evento
                </div>
                <button
                  type="button"
                  onClick={openMessageModal}
                  className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  Enviar mensaje
                </button>
              </div>
              {eventError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {eventError}
                </div>
              )}
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-zinc-700">
                    Tipo
                  </label>
                  <select
                    value={eventType}
                    onChange={(event) =>
                      setEventType(event.target.value as ContractEventType)
                    }
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  >
                    {eventTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700">
                    Fecha y hora
                  </label>
                  <input
                    type="datetime-local"
                    value={eventAt}
                    onChange={(event) => setEventAt(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-zinc-700">
                    Detalle
                  </label>
                  <textarea
                    rows={3}
                    value={eventDetail}
                    onChange={(event) => setEventDetail(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                    placeholder="Descripcion del evento"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700">
                    Tags (separados por coma)
                  </label>
                  <input
                    type="text"
                    value={eventTags}
                    onChange={(event) => setEventTags(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                    placeholder="Ej: llamado, atraso"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700">
                    Asociar a cuota (opcional)
                  </label>
                  <select
                    value={eventInstallmentId}
                    onChange={(event) =>
                      setEventInstallmentId(event.target.value)
                    }
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  >
                    <option value="">Sin asociar</option>
                    {installments.map((installment) => (
                      <option key={installment.id} value={installment.id}>
                        {installment.period}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-zinc-700">
                    Adjuntos (opcional)
                  </label>
                  <input
                    key={eventAttachmentsKey}
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(event) =>
                      setEventAttachments(Array.from(event.target.files ?? []))
                    }
                    className="mt-2 w-full text-sm text-zinc-900 file:mr-3 file:rounded-md file:border file:border-zinc-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-100"
                  />
                  {eventAttachments.length > 0 && (
                    <div className="mt-1 text-[11px] text-zinc-500">
                      {eventAttachments.length} adjunto(s) seleccionado(s)
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={eventSubmitting}
                  onClick={async () => {
                    if (!tenantId || !contract) return;
                    if (!user?.uid) {
                      setEventError("No se pudo obtener el usuario.");
                      return;
                    }
                    const detailValue = eventDetail.trim();
                    if (!detailValue) {
                      setEventError("El detalle es obligatorio.");
                      return;
                    }
                    if (!eventType) {
                      setEventError("El tipo es obligatorio.");
                      return;
                    }
                    const atDate = eventAt ? new Date(eventAt) : new Date();
                    if (!Number.isFinite(atDate.getTime())) {
                      setEventError("La fecha es invalida.");
                      return;
                    }
                    setEventSubmitting(true);
                    setEventError(null);
                    try {
                      const tags = parseTags(eventTags);
                      const eventId = await addContractEvent(
                        tenantId,
                        contract.id,
                        {
                          type: eventType,
                          at: atDate,
                          detail: detailValue,
                          tags: tags.length > 0 ? tags : undefined,
                          installmentId: eventInstallmentId || undefined,
                          createdBy: user.uid,
                        }
                      );
                      if (eventAttachments.length > 0) {
                        const uploaded = await Promise.all(
                          eventAttachments.map((file) =>
                            uploadEventAttachment(
                              tenantId,
                              contract.id,
                              eventId,
                              file
                            )
                          )
                        );
                        await updateContractEventAttachments(
                          tenantId,
                          contract.id,
                          eventId,
                          uploaded
                        );
                      }
                      await loadContractEvents(tenantId, contract.id);
                      resetEventForm();
                    } catch (err: any) {
                      setEventError(
                        err?.message ?? "No se pudo guardar el evento."
                      );
                    } finally {
                      setEventSubmitting(false);
                    }
                  }}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {eventSubmitting ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold text-zinc-900">
                Eventos
              </div>
              {contractEventsError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {contractEventsError}
                </div>
              )}
              {contractEventsLoading ? (
                <div className="text-sm text-zinc-600">Cargando eventos...</div>
              ) : contractEvents.length === 0 ? (
                <div className="text-sm text-zinc-600">
                  Sin eventos registrados.
                </div>
              ) : (
                <div className="space-y-3">
                  {contractEvents.map((eventItem) => {
                    const installmentLabel = eventItem.installmentId
                      ? installmentLabelById.get(eventItem.installmentId) ||
                        eventItem.installmentId
                      : null;
                    return (
                      <div
                        key={eventItem.id}
                        className="rounded-lg border border-zinc-200 bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                            {eventItem.type}
                          </span>
                          <span>{formatEventAt(eventItem.at)}</span>
                        </div>
                        <div className="mt-2 text-sm text-zinc-900">
                          {eventItem.detail}
                        </div>
                        {(eventItem.tags && eventItem.tags.length > 0) ||
                        installmentLabel ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
                            {installmentLabel && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                                {installmentLabel}
                              </span>
                            )}
                            {eventItem.tags?.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-600"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {eventItem.attachments &&
                          eventItem.attachments.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2 text-xs">
                              {eventItem.attachments.map((attachment) => (
                                <Link
                                  key={attachment.path}
                                  href={attachment.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-zinc-200 px-2 py-1 text-zinc-600 hover:text-zinc-900"
                                >
                                  {attachment.name}
                                </Link>
                              ))}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
        {tab === "documentos" && (
          <div className="space-y-3">
            <div className="text-sm text-zinc-600">
              Descarga un ZIP con datos y adjuntos del contrato.
            </div>
            {exportZipError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {exportZipError}
              </div>
            )}
            {exportZipSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {exportZipSuccess}
              </div>
            )}
            <button
              type="button"
              disabled={exportingZip}
              onClick={async () => {
                if (!tenantId || !contract) return;
                setExportingZip(true);
                setExportZipError(null);
                setExportZipSuccess(null);
                try {
                  await exportContractZip(tenantId, contract.id);
                  setExportZipSuccess("ZIP generado.");
                } catch (err: any) {
                  setExportZipError(
                    err?.message ?? "No se pudo exportar el ZIP."
                  );
                } finally {
                  setExportingZip(false);
                }
              }}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {exportingZip ? "Generando..." : "Descargar expediente ZIP"}
            </button>
          </div>
        )}
      </div>

      {tenantId && (
        <div className="text-xs text-zinc-400">Tenant: {tenantId}</div>
      )}

      {messageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                Enviar mensaje
              </h3>
              <button
                type="button"
                onClick={closeMessageModal}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                Cerrar
              </button>
            </div>
            {messageError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {messageError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Destinatario
                </label>
                <select
                  value={messageRecipient}
                  onChange={(event) =>
                    setMessageRecipient(
                      event.target.value as "tenant" | "guarantors" | "both"
                    )
                  }
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                >
                  <option value="tenant">Locatario</option>
                  <option value="guarantors">Garantes</option>
                  <option value="both">Ambos</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Canal
                </label>
                <select
                  value={messageChannel}
                  onChange={(event) =>
                    setMessageChannel(
                      event.target.value as "whatsapp" | "email" | "copy"
                    )
                  }
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="copy">Copiar texto</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Texto libre
                </label>
                <textarea
                  rows={3}
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  placeholder="Escribe el mensaje"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeMessageModal}
                disabled={messageSubmitting}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={messageSubmitting}
                onClick={async () => {
                  if (!tenantId || !contract) return;
                  const textValue = messageText.trim();
                  if (!textValue) {
                    setMessageError("El mensaje es obligatorio.");
                    return;
                  }
                  setMessageSubmitting(true);
                  setMessageError(null);
                  try {
                    const recipients =
                      messageRecipient === "both"
                        ? ["tenant", "guarantors"]
                        : [messageRecipient];
                    await addDoc(
                      collection(
                        db,
                        "tenants",
                        tenantId,
                        "contracts",
                        contract.id,
                        "events"
                      ),
                      {
                        type: "message",
                        recipients,
                        channel: messageChannel,
                        messageSnippet: textValue.slice(0, 140),
                        createdAt: serverTimestamp(),
                      }
                    );
                    setMessageModalOpen(false);
                  } catch (err: any) {
                    setMessageError(
                      err?.message ?? "No se pudo registrar el mensaje."
                    );
                  } finally {
                    setMessageSubmitting(false);
                  }
                }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {messageSubmitting ? "Guardando..." : "Registrar mensaje"}
              </button>
            </div>
          </div>
        </div>
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
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Fecha y hora
                </label>
                <input
                  type="datetime-local"
                  value={paymentPaidAt}
                  onChange={(event) => setPaymentPaidAt(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Medio de pago
                </label>
                <select
                  value={paymentMethod}
                  onChange={(event) =>
                    setPaymentMethod(event.target.value as PaymentMethod)
                  }
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                >
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                  <option value="TARJETA">Tarjeta</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={paymentWithoutReceipt}
                  onChange={(event) =>
                    setPaymentWithoutReceipt(() => {
                      const next = event.target.checked;
                      if (next) {
                        setPaymentReceiptFile(null);
                      }
                      return next;
                    })
                  }
                />
                Sin comprobante
              </label>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Comprobante (opcional)
                </label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  disabled={paymentWithoutReceipt}
                  onChange={(event) =>
                    setPaymentReceiptFile(event.target.files?.[0] ?? null)
                  }
                  className="mt-2 w-full text-sm text-zinc-900 file:mr-3 file:rounded-md file:border file:border-zinc-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400"
                />
                {paymentWithoutReceipt && (
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Se omite el comprobante.
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Nota (opcional)
                </label>
                <textarea
                  rows={2}
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
                  if (!user?.uid) {
                    setPaymentError("No se pudo obtener el usuario.");
                    return;
                  }
                  const amountValue = Number(paymentAmount);
                  if (!Number.isFinite(amountValue) || amountValue <= 0) {
                    setPaymentError("El monto debe ser mayor a 0.");
                    return;
                  }
                  if (!paymentMethod) {
                    setPaymentError("Selecciona el medio de pago.");
                    return;
                  }
                  const paidAtDate = paymentPaidAt
                    ? new Date(paymentPaidAt)
                    : new Date();
                  if (!Number.isFinite(paidAtDate.getTime())) {
                    setPaymentError("La fecha de pago es invalida.");
                    return;
                  }
                  setPaymentSubmitting(true);
                  setPaymentError(null);
                  try {
                    let receipt;
                    if (!paymentWithoutReceipt && paymentReceiptFile) {
                      receipt = await uploadPaymentReceipt(
                        tenantId,
                        paymentInstallment.id,
                        paymentReceiptFile
                      );
                    }
                    await registerInstallmentPayment(
                      tenantId,
                      paymentInstallment.id,
                      {
                        amount: amountValue,
                        withoutReceipt: paymentWithoutReceipt,
                        method: paymentMethod,
                        paidAt: paidAtDate,
                        note: paymentNote || undefined,
                        receipt,
                        collectedBy: user.uid,
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
