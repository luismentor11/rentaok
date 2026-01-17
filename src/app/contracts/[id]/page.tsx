"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { getContract, updateContract, ContractRecord } from "@/lib/db/contracts";
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
import ServicesTab from "@/components/contracts/ServicesTab";
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
import {
  getGuaranteeTypeLabel,
  guaranteeTypeLabels,
  normalizeGuaranteeType,
} from "@/lib/model/v1";
import { recordDebugError } from "@/lib/debug";

const tabOptions = [
  { key: "resumen", label: "Resumen" },
  { key: "pagos", label: "Canon/Mes" },
  { key: "documentos", label: "Documentos" },
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

const installmentStatusBadgeClass: Record<string, string> = {
  POR_VENCER: "bg-success/20 text-success border border-success/40",
  VENCE_HOY: "bg-warning/20 text-warning border border-warning/40",
  VENCIDA: "bg-danger/20 text-danger border border-danger/40",
  EN_ACUERDO: "bg-risk/20 text-risk border border-risk/40",
  PARCIAL: "bg-warning/20 text-warning border border-warning/40",
  PAGADA: "bg-success/20 text-success border border-success/40",
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

const emptyParty = { fullName: "", dni: "", email: "", whatsapp: "" };

const normalizeContract = (
  contract: ContractRecordWithProperty
): ContractRecordWithProperty => {
  const parties = contract.parties ?? {};
  return {
    ...contract,
    parties: {
      ...parties,
      owner: { ...emptyParty, ...(parties.owner ?? {}) },
      tenant: { ...emptyParty, ...(parties.tenant ?? {}) },
    },
  };
};

export default function ContractDetailPage({ params }: PageProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const routeParams = useParams();
  const routeId =
    typeof routeParams?.id === "string" ? routeParams.id : params.id;
  const normalizedRouteId =
    typeof routeId === "string" && routeId.trim() ? routeId.trim() : "";
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [contract, setContract] = useState<ContractRecordWithProperty | null>(
    null
  );
  const [installments, setInstallments] = useState<InstallmentRecord[]>([]);
  const [installmentsLoading, setInstallmentsLoading] = useState(false);
  const [installmentsErrorText, setInstallmentsErrorText] = useState<
    string | null
  >(null);
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
  const [invalidContractId, setInvalidContractId] = useState(false);
  const [contractNotFound, setContractNotFound] = useState(false);
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
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    dates: { startDate: "", endDate: "" },
    dueDay: "",
    rentAmount: "",
    updateRule: { type: "MANUAL", periodMonths: "" },
    parties: {
      owner: { ...emptyParty },
      tenant: { ...emptyParty },
    },
    guaranteeType: "OTRO",
    guaranteeDetails: "",
  });
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

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
      setInvalidContractId(false);
      setContractNotFound(false);
      if (!normalizedRouteId) {
        setInvalidContractId(true);
        setContract(null);
        setPageLoading(false);
        return;
      }
      try {
        const profile = await getUserProfile(user.uid);
        if (!active) return;
        const nextTenantId = profile?.tenantId ?? null;
        setUserRole(profile?.role ?? null);
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          router.replace("/onboarding");
          return;
        }
        const data = await getContract(nextTenantId, normalizedRouteId);
        if (!active) return;
        if (!data) {
          setContractNotFound(true);
          setContract(null);
          return;
        }
        setContract(normalizeContract(data));
      } catch (err: any) {
        if (!active) return;
        console.error("ContractDetail:load", err);
        recordDebugError("contracts:detail", err);
        setError("No pudimos cargar el contrato.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [user, loading, router, normalizedRouteId]);

  const formatDueDate = (value: InstallmentRecord["dueDate"]) => {
    const date = toDateSafe(value);
    return date ? date.toLocaleDateString() : "-";
  };

  const formatEventAt = (value: EventRecord["at"]) => {
    const date = toDateSafe(value);
    return date ? date.toLocaleString() : "-";
  };

  const formatAmount = (value?: number) => {
    if (!Number.isFinite(Number(value))) return "-";
    return Number(value).toLocaleString("es-AR");
  };

  const getPeriodSortKey = (value: InstallmentRecord["period"]) => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : trimmed;
    }
    return "";
  };

  const loadInstallments = async (tenant: string, contractId: string) => {
    setInstallmentsLoading(true);
    setInstallmentsErrorText(null);
    try {
      const installmentsRef = collection(db, "tenants", tenant, "installments");
      const q = query(
        installmentsRef,
        where("contractId", "==", contractId)
      );
      const snap = await getDocs(q);
      const nextInstallments = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<InstallmentRecord, "id">),
      }));
      nextInstallments.sort((a, b) => {
        const dateA = toDateSafe(a.dueDate);
        const dateB = toDateSafe(b.dueDate);
        if (dateA && dateB) {
          return dateA.getTime() - dateB.getTime();
        }
        const periodA = getPeriodSortKey(a.period);
        const periodB = getPeriodSortKey(b.period);
        if (typeof periodA === "number" && typeof periodB === "number") {
          return periodA - periodB;
        }
        return String(periodA).localeCompare(String(periodB));
      });
      setInstallments(nextInstallments);
    } catch (err: any) {
      console.error("ContractTab:Pagos ERROR", err);
      recordDebugError("contracts:detail:installments", err);
      setInstallmentsErrorText("No pudimos cargar Canon/Mes. Proba de nuevo.");
      setInstallments([]);
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
      console.error("ContractTab:items", err);
      recordDebugError("contracts:detail:items", err);
      setInstallmentItemsError((prev) => ({
        ...prev,
        [installmentId]: "No pudimos cargar items. Proba de nuevo.",
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
      console.error("ContractTab:events", err);
      recordDebugError("contracts:detail:events", err);
      setContractEventsError("No pudimos cargar eventos. Proba de nuevo.");
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

  const paymentAmountValue = Number(paymentAmount);
  const paymentDateValue = paymentPaidAt ? new Date(paymentPaidAt) : new Date();
  const isPaymentFormValid =
    Number.isFinite(paymentAmountValue) &&
    paymentAmountValue > 0 &&
    Boolean(paymentMethod) &&
    Number.isFinite(paymentDateValue.getTime());

  const itemAmountValue = Number(itemAmount);
  const isItemFormValid =
    Boolean(itemLabel.trim()) &&
    Number.isFinite(itemAmountValue) &&
    itemAmountValue !== 0 &&
    (itemType === "DESCUENTO" ? true : itemAmountValue > 0);

  const lateFeeAmountValue = Number(lateFeeAmount);
  const isLateFeeFormValid =
    Number.isFinite(lateFeeAmountValue) && lateFeeAmountValue > 0;

  useEffect(() => {
    if (!tenantId || !contract) return;
    loadInstallments(tenantId, contract.id);
    loadContractEvents(tenantId, contract.id);
    resetEventForm();
  }, [tenantId, contract]);

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

  if (invalidContractId) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
        <div>Contrato invalido.</div>
      </div>
    );
  }

  if (contractNotFound) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
        <div>Contrato no encontrado.</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
        <div>No pudimos cargar el contrato. Proba de nuevo.</div>
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600">
        <div>Cargando tenant...</div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
        <div>Contrato no encontrado.</div>
      </div>
    );
  }

  const tenantEmail = contract.parties?.tenant?.email?.trim() ?? "";
  const tenantWhatsapp = contract.parties?.tenant?.whatsapp?.trim() ?? "";
  const contractNotificationsEnabled = Boolean(contract.notificationConfig?.enabled);
  const guarantors = contract.guarantors ?? [];
  const contractTitle = contract.property?.title ?? "-";
  const contractAddress = contract.property?.address ?? "-";
  const contractStartDate = contract.dates?.startDate ?? "-";
  const contractEndDate = contract.dates?.endDate ?? "-";
  const contractDueDay = contract.dueDay ?? "-";
  const contractRentAmount = formatAmount(contract.rentAmount);
  const contractDepositAmount = formatAmount(contract.depositAmount);
  const normalizedGuaranteeType = normalizeGuaranteeType(
    contract.guaranteeType
  );
  const contractGuaranteeLabel = getGuaranteeTypeLabel(
    contract.guaranteeType
  );
  const contractGuaranteeDetails =
    (contract as ContractRecordWithProperty & { guaranteeDetails?: string })
      .guaranteeDetails ?? "";

  const isGuarantorsGuarantee = normalizedGuaranteeType === "GARANTES";
  const isCaucionGuarantee = normalizedGuaranteeType === "CAUCION";
  const isConvenioGuarantee =
    normalizedGuaranteeType === "CONVENIO_DESALOJO";
  const guaranteeDetailFallback =
    contractGuaranteeDetails ||
    (isCaucionGuarantee && contractDepositAmount !== "-"
      ? `Deposito ${contractDepositAmount}`
      : "");

  const openEditModal = () => {
    setEditError(null);
    setEditForm({
      dates: {
        startDate: contract.dates?.startDate ?? "",
        endDate: contract.dates?.endDate ?? "",
      },
      dueDay: String(contract.dueDay ?? ""),
      rentAmount: String(contract.rentAmount ?? ""),
      updateRule: {
        type: contract.updateRule?.type ?? "MANUAL",
        periodMonths: String(contract.updateRule?.periodMonths ?? ""),
      },
      parties: {
        owner: {
          fullName: contract.parties?.owner?.fullName ?? "",
          dni: contract.parties?.owner?.dni ?? "",
          email: contract.parties?.owner?.email ?? "",
          whatsapp: contract.parties?.owner?.whatsapp ?? "",
        },
        tenant: {
          fullName: contract.parties?.tenant?.fullName ?? "",
          dni: contract.parties?.tenant?.dni ?? "",
          email: contract.parties?.tenant?.email ?? "",
          whatsapp: contract.parties?.tenant?.whatsapp ?? "",
        },
      },
      guaranteeType: normalizedGuaranteeType,
      guaranteeDetails: contractGuaranteeDetails,
    });
    setEditModalOpen(true);
  };

  const openDeleteModal = () => {
    setDeleteError(null);
    setDeleteReason("");
    setDeleteModalOpen(true);
  };

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
      console.error("ContractTab:notifications", err);
      recordDebugError("contracts:detail:notifications", err);
      setContractNotificationError(
        "No pudimos guardar la configuracion. Proba de nuevo."
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
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm text-zinc-500">
                  Contrato {contract.id ?? "-"}
                </div>
                <h1 className="text-2xl font-semibold text-zinc-900">
                  {contractTitle}
                </h1>
                <p className="text-sm text-zinc-600">{contractAddress}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={openEditModal}
                  className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  onClick={openDeleteModal}
                >
                  Eliminar
                </button>
              </div>
            </div>

            <div className="h-px bg-border/60" />

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
                <div className="text-xs font-semibold text-zinc-500">
                  Datos del contrato
                </div>
                <div className="grid gap-2 text-sm text-zinc-600">
                  <div>
                    <span className="font-medium text-zinc-900">Inicio:</span>{" "}
                    {contractStartDate}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">Fin:</span>{" "}
                    {contractEndDate}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">Vence:</span>{" "}
                    dia {contractDueDay}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">Canon/Mes:</span>{" "}
                    {contractRentAmount}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">
                      Actualizacion:
                    </span>{" "}
                    {contract.updateRule?.type ?? "-"}
                    {contract.updateRule?.periodMonths
                      ? ` cada ${contract.updateRule.periodMonths} meses`
                      : ""}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">Deposito:</span>{" "}
                    {contractDepositAmount}
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900">Creado por:</span>{" "}
                    {contract.createdByUid ?? "-"}
                  </div>
                </div>
                <div className="text-sm">
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

              <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2">
                <div className="text-xs font-semibold text-zinc-500">Propiedad</div>
                <div className="text-sm font-medium text-zinc-900">
                  {contractTitle}
                </div>
                <div className="text-xs text-zinc-500">{contractAddress}</div>
                <div className="text-xs text-zinc-500">
                  ID: {contract.property?.id ?? "-"}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="text-xs font-semibold text-zinc-500">Locatario</div>
                <div className="text-sm font-medium text-zinc-900">
                  {contract.parties?.tenant?.fullName ?? "-"}
                </div>
                <div className="text-xs text-zinc-500">
                  DNI: {contract.parties?.tenant?.dni ?? "-"} |{" "}
                  {contract.parties?.tenant?.address ?? "Sin direccion"}
                </div>
                <div className="text-xs text-zinc-500">
                  {contract.parties?.tenant?.email ?? "Sin email"} |{" "}
                  {contract.parties?.tenant?.whatsapp ?? "Sin WhatsApp"}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="text-xs font-semibold text-zinc-500">Propietario</div>
                <div className="text-sm font-medium text-zinc-900">
                  {contract.parties?.owner?.fullName ?? "-"}
                </div>
                <div className="text-xs text-zinc-500">
                  DNI: {contract.parties?.owner?.dni ?? "-"} |{" "}
                  {contract.parties?.owner?.address ?? "Sin direccion"}
                </div>
                <div className="text-xs text-zinc-500">
                  {contract.parties?.owner?.email ?? "Sin email"} |{" "}
                  {contract.parties?.owner?.whatsapp ?? "Sin WhatsApp"}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2">
              <div className="text-xs font-semibold text-zinc-500">
                Servicios incluidos
              </div>
              <div className="text-sm text-zinc-600">
                Configuracion del contrato. Se reflejan en Canon/Mes.
              </div>
              <ServicesTab contractId={contract.id} role={userRole ?? "owner"} />
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
              <div className="text-xs font-semibold text-zinc-500">Garantia</div>
              <div className="text-sm text-zinc-600">
                <span className="font-medium text-zinc-900">Tipo:</span>{" "}
                {contractGuaranteeLabel}
              </div>
              {isGuarantorsGuarantee ? (
                guarantors.length ? (
                  <div className="space-y-2">
                    {guarantors.map((guarantor, index) => (
                      <div
                        key={`${guarantor.fullName ?? "garante"}-${index}`}
                        className="rounded-lg border border-zinc-200 p-3"
                      >
                        <div className="text-sm font-medium text-zinc-900">
                          {guarantor.fullName ?? "-"}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {guarantor.dni ? `DNI: ${guarantor.dni}` : "DNI: -"} |{" "}
                          {guarantor.address ?? "-"}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {guarantor.email ?? "Sin email"} |{" "}
                          {guarantor.whatsapp ?? "Sin WhatsApp"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500">(sin garantes)</div>
                )
              ) : guaranteeDetailFallback ? (
                <div className="text-sm text-zinc-600">
                  <span className="font-medium text-zinc-900">Detalle:</span>{" "}
                  {guaranteeDetailFallback}
                </div>
              ) : isConvenioGuarantee ? (
                <div className="text-xs text-zinc-500">Sin detalle</div>
              ) : (
                <div className="text-xs text-zinc-500">Sin detalle</div>
              )}
            </div>
          </div>
        )}
        {tab === "pagos" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-zinc-600">
                Canon/Mes generado por periodo.
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!tenantId || !contract) return;
                  const ok = window.confirm(
                    "Esto creara Canon/Mes para este contrato."
                  );
                  if (!ok) return;
                  setInstallmentsErrorText(null);
                  setInstallmentsLoading(true);
                  try {
                    await generateInstallmentsForContract(tenantId, contract);
                    await loadInstallments(tenantId, contract.id);
                  } catch (err: any) {
                    console.error("ContractTab:Pagos ERROR", err);
                    recordDebugError("contracts:detail:installments:create", err);
                    setInstallmentsErrorText(
                      "No pudimos generar Canon/Mes. Proba de nuevo."
                    );
                  } finally {
                    setInstallmentsLoading(false);
                  }
                }}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Generar Canon/Mes
              </button>
            </div>
            {installmentsErrorText && (
              <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
                {installmentsErrorText}
              </div>
            )}
            {installmentsLoading ? (
              <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
                Cargando...
              </div>
            ) : installments.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
                No hay periodos para mostrar.
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
                    <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                      <span>Estado:</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          installmentStatusBadgeClass[installment.status ?? ""] ||
                          "bg-zinc-100 text-zinc-600 border border-zinc-200"
                        }`}
                      >
                        {installment.status ?? "-"}
                      </span>
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
                              ? "Override activo para este periodo."
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
                              setInstallmentsErrorText(null);
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
                                console.error("ContractTab:Pagos ERROR", err);
                                recordDebugError(
                                  "contracts:detail:installments:notify",
                                  err
                                );
                                setInstallmentsErrorText(
                                  "No pudimos actualizar la notificacion. Proba de nuevo."
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
                          Notificar este periodo
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
                              setInstallmentsErrorText(
                                "No se pudo obtener el usuario."
                              );
                              return;
                            }
                            const ok = window.confirm(
                              "Esto marca el periodo como PAGADO sin comprobante. Continuar?"
                            );
                            if (!ok) return;
                            setInstallmentActions((prev) => ({
                              ...prev,
                              [installment.id]: {
                                ...prev[installment.id],
                                markPaid: true,
                              },
                            }));
                            setInstallmentsErrorText(null);
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
                              console.error("ContractTab:Pagos ERROR", err);
                              recordDebugError(
                                "contracts:detail:installments:markPaid",
                                err
                              );
                              setInstallmentsErrorText(
                                "No pudimos marcar el periodo. Proba de nuevo."
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
                        <div className="mt-2 rounded border border-zinc-200 bg-surface px-2 py-1 text-xs text-zinc-600">
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
                                            console.error("ContractTab:items:delete", err);
                                            recordDebugError("contracts:detail:items:delete", err);
                                            setInstallmentItemsError((prev) => ({
                                              ...prev,
                                              [installment.id]:
                                                "No pudimos borrar el item. Proba de nuevo.",
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
                  <div className="relative mt-2">
                    <input
                      type="datetime-local"
                      value={eventAt}
                      onChange={(event) => setEventAt(event.target.value)}
                      className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                    />
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <path d="M8 2v4M16 2v4M3 10h18" />
                      <path d="M12 14v4M12 14h3" />
                    </svg>
                  </div>
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
                    Asociar a periodo (opcional)
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
                      console.error("ContractTab:events:save", err);
                      recordDebugError("contracts:detail:events:save", err);
                      setEventError(
                        "No pudimos guardar el evento. Proba de nuevo."
                      );
                    } finally {
                      setEventSubmitting(false);
                    }
                  }}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                {eventSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4 animate-spin"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        className="opacity-75"
                        d="M21 12a9 9 0 0 0-9-9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    Guardando...
                  </span>
                ) : (
                  "Guardar"
                )}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold text-zinc-900">
                Eventos
              </div>
              {contractEventsError && (
                <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
                  {contractEventsError}
                </div>
              )}
              {contractEventsLoading ? (
                <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
                  Cargando...
                </div>
              ) : contractEvents.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
                  No hay actividad para mostrar.
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
              <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
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
                  console.error("ContractTab:export", err);
                  recordDebugError("contracts:detail:export", err);
                  setExportZipError(
                    "No pudimos exportar el ZIP. Proba de nuevo."
                  );
                } finally {
                  setExportingZip(false);
                }
              }}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {exportingZip ? (
                <span className="inline-flex items-center gap-2">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4 animate-spin"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="9"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      className="opacity-75"
                      d="M21 12a9 9 0 0 0-9-9"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                  Generando...
                </span>
              ) : (
                "Descargar expediente ZIP"
              )}
            </button>
          </div>
        )}
      </div>

      {messageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 modal-backdrop">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg modal-panel">
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
                      console.error("ContractTab:message", err);
                      recordDebugError("contracts:detail:message", err);
                      setMessageError(
                        "No pudimos registrar el mensaje. Proba de nuevo."
                      );
                    } finally {
                      setMessageSubmitting(false);
                    }
                  }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {messageSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4 animate-spin"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        className="opacity-75"
                        d="M21 12a9 9 0 0 0-9-9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    Guardando...
                  </span>
                ) : (
                  "Registrar mensaje"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentModalOpen && paymentInstallment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 modal-backdrop">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg modal-panel">
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
                <div className="relative mt-2">
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                    placeholder="1000"
                  />
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 6h8a4 4 0 0 1 0 8H8" />
                    <path d="M8 14h7a3 3 0 0 1 0 6H6" />
                  </svg>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Fecha y hora
                </label>
                <div className="relative mt-2">
                  <input
                    type="datetime-local"
                    value={paymentPaidAt}
                    onChange={(event) => setPaymentPaidAt(event.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  />
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M8 2v4M16 2v4M3 10h18" />
                    <path d="M12 14v4M12 14h3" />
                  </svg>
                </div>
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
                disabled={paymentSubmitting || !isPaymentFormValid}
                onClick={async () => {
                  if (!tenantId || !paymentInstallment) return;
                  if (paymentSubmitting) return;
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
                    const paymentResult = await registerInstallmentPayment(
                      tenantId,
                      paymentInstallment.id,
                      {
                        amount: amountValue,
                        withoutReceipt: paymentWithoutReceipt,
                        method: paymentMethod,
                        paidAt: paidAtDate,
                        note: paymentNote || undefined,
                        collectedBy: user.uid,
                        createdByUid: user.uid,
                      }
                    );
                    if (!paymentWithoutReceipt && paymentReceiptFile) {
                      const receipt = await uploadPaymentReceipt(
                        tenantId,
                        paymentResult.paymentId,
                        paymentReceiptFile
                      );
                      await updateDoc(
                        doc(
                          db,
                          "tenants",
                          tenantId,
                          "installments",
                          paymentInstallment.id,
                          "payments",
                          paymentResult.paymentId
                        ),
                        {
                          receipt,
                          updatedAt: serverTimestamp(),
                        }
                      );
                    }
                    await loadInstallments(tenantId, paymentInstallment.contractId);
                    setPaymentModalOpen(false);
                    setPaymentInstallment(null);
                    } catch (err: any) {
                      console.error("ContractTab:payment", err);
                      recordDebugError("contracts:detail:payment", err);
                      setPaymentError(
                        "No pudimos registrar el pago. Proba de nuevo."
                      );
                    } finally {
                      setPaymentSubmitting(false);
                    }
                  }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {paymentSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4 animate-spin"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        className="opacity-75"
                        d="M21 12a9 9 0 0 0-9-9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    Guardando...
                  </span>
                ) : (
                  "Guardar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {itemModalOpen && itemInstallment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 modal-backdrop">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg modal-panel">
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
                <div className="relative mt-2">
                  <input
                    type="number"
                    value={itemAmount}
                    onChange={(event) => setItemAmount(event.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                    placeholder="1000"
                  />
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 6h8a4 4 0 0 1 0 8H8" />
                    <path d="M8 14h7a3 3 0 0 1 0 6H6" />
                  </svg>
                </div>
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
                disabled={itemSubmitting || !isItemFormValid}
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
                      console.error("ContractTab:item", err);
                      recordDebugError("contracts:detail:item", err);
                      setItemError(
                        "No pudimos guardar el item. Proba de nuevo."
                      );
                    } finally {
                      setItemSubmitting(false);
                    }
                  }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {itemSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4 animate-spin"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        className="opacity-75"
                        d="M21 12a9 9 0 0 0-9-9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    Guardando...
                  </span>
                ) : (
                  "Guardar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {lateFeeModalOpen && lateFeeInstallment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 modal-backdrop">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg modal-panel">
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
                <div className="relative mt-2">
                  <input
                    type="number"
                    value={lateFeeAmount}
                    onChange={(event) => setLateFeeAmount(event.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                    placeholder="3000"
                  />
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 6h8a4 4 0 0 1 0 8H8" />
                    <path d="M8 14h7a3 3 0 0 1 0 6H6" />
                  </svg>
                </div>
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
                disabled={lateFeeSubmitting || !isLateFeeFormValid}
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
                    console.error("ContractTab:lateFee", err);
                    recordDebugError("contracts:detail:lateFee", err);
                    setLateFeeError(
                      "No pudimos agregar la mora. Proba de nuevo."
                    );
                  } finally {
                    setLateFeeSubmitting(false);
                  }
                }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {lateFeeSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4 animate-spin"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        className="opacity-75"
                        d="M21 12a9 9 0 0 0-9-9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    Guardando...
                  </span>
                ) : (
                  "Guardar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {editModalOpen && contract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 modal-backdrop">
          <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg modal-panel">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                Editar contrato
              </h3>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                Cerrar
              </button>
            </div>
            {editError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {editError}
              </div>
            )}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Inicio
                </label>
                <div className="relative mt-1">
                  <input
                    type="date"
                    value={editForm.dates.startDate}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        dates: { ...prev.dates, startDate: event.target.value },
                      }))
                    }
                    className="w-full rounded-md border border-zinc-200 py-2 pl-9 pr-3 text-sm text-zinc-900"
                  />
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M8 2v4M16 2v4M3 10h18" />
                  </svg>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Fin
                </label>
                <div className="relative mt-1">
                  <input
                    type="date"
                    value={editForm.dates.endDate}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        dates: { ...prev.dates, endDate: event.target.value },
                      }))
                    }
                    className="w-full rounded-md border border-zinc-200 py-2 pl-9 pr-3 text-sm text-zinc-900"
                  />
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M8 2v4M16 2v4M3 10h18" />
                  </svg>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Dia de vencimiento
                </label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={editForm.dueDay}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      dueDay: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Canon/Mes
                </label>
                <div className="relative mt-1">
                  <input
                    type="number"
                    value={editForm.rentAmount}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        rentAmount: event.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-zinc-200 py-2 pl-9 pr-3 text-sm text-zinc-900"
                  />
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 6h8a4 4 0 0 1 0 8H8" />
                    <path d="M8 14h7a3 3 0 0 1 0 6H6" />
                  </svg>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Regla de actualizacion
                </label>
                <select
                  value={editForm.updateRule.type}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      updateRule: {
                        ...prev.updateRule,
                        type: event.target.value,
                      },
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                >
                  <option value="IPC">IPC</option>
                  <option value="ICL">ICL</option>
                  <option value="FIJO">Fijo</option>
                  <option value="MANUAL">Manual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Periodo (meses)
                </label>
                <input
                  type="number"
                  min={0}
                  value={editForm.updateRule.periodMonths}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      updateRule: {
                        ...prev.updateRule,
                        periodMonths: event.target.value,
                      },
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Propietario
                </label>
                <input
                  type="text"
                  value={editForm.parties?.owner?.fullName ?? ""}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      parties: {
                        ...(prev.parties ?? {}),
                        owner: {
                          ...(prev.parties?.owner ?? emptyParty),
                          fullName: event.target.value,
                        },
                      },
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                  placeholder="Nombre completo"
                />
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <input
                    type="text"
                    value={editForm.parties?.owner?.dni ?? ""}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        parties: {
                          ...(prev.parties ?? {}),
                          owner: {
                            ...(prev.parties?.owner ?? emptyParty),
                            dni: event.target.value,
                          },
                        },
                      }))
                    }
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                    placeholder="DNI"
                  />
                  <input
                    type="text"
                    value={editForm.parties?.owner?.whatsapp ?? ""}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        parties: {
                          ...(prev.parties ?? {}),
                          owner: {
                            ...(prev.parties?.owner ?? emptyParty),
                            whatsapp: event.target.value,
                          },
                        },
                      }))
                    }
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                    placeholder="WhatsApp"
                  />
                  <input
                    type="email"
                    value={editForm.parties?.owner?.email ?? ""}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        parties: {
                          ...(prev.parties ?? {}),
                          owner: {
                            ...(prev.parties?.owner ?? emptyParty),
                            email: event.target.value,
                          },
                        },
                      }))
                    }
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 md:col-span-2"
                    placeholder="Email"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Locatario
                </label>
                <input
                  type="text"
                  value={editForm.parties?.tenant?.fullName ?? ""}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      parties: {
                        ...(prev.parties ?? {}),
                        tenant: {
                          ...(prev.parties?.tenant ?? emptyParty),
                          fullName: event.target.value,
                        },
                      },
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                  placeholder="Nombre completo"
                />
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <input
                    type="text"
                    value={editForm.parties?.tenant?.dni ?? ""}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        parties: {
                          ...(prev.parties ?? {}),
                          tenant: {
                            ...(prev.parties?.tenant ?? emptyParty),
                            dni: event.target.value,
                          },
                        },
                      }))
                    }
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                    placeholder="DNI"
                  />
                  <input
                    type="text"
                    value={editForm.parties?.tenant?.whatsapp ?? ""}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        parties: {
                          ...(prev.parties ?? {}),
                          tenant: {
                            ...(prev.parties?.tenant ?? emptyParty),
                            whatsapp: event.target.value,
                          },
                        },
                      }))
                    }
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                    placeholder="WhatsApp"
                  />
                  <input
                    type="email"
                    value={editForm.parties?.tenant?.email ?? ""}
                    onChange={(event) =>
                      setEditForm((prev) => ({
                        ...prev,
                        parties: {
                          ...(prev.parties ?? {}),
                          tenant: {
                            ...(prev.parties?.tenant ?? emptyParty),
                            email: event.target.value,
                          },
                        },
                      }))
                    }
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 md:col-span-2"
                    placeholder="Email"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Tipo de garantia
                </label>
                <select
                  value={editForm.guaranteeType}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      guaranteeType: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                >
                  <option value="GARANTES">{guaranteeTypeLabels.GARANTES}</option>
                  <option value="CAUCION">{guaranteeTypeLabels.CAUCION}</option>
                  <option value="CONVENIO_DESALOJO">
                    {guaranteeTypeLabels.CONVENIO_DESALOJO}
                  </option>
                  <option value="OTRO">{guaranteeTypeLabels.OTRO}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700">
                  Detalle de garantia
                </label>
                <input
                  type="text"
                  value={editForm.guaranteeDetails}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      guaranteeDetails: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                  placeholder="Detalle"
                />
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                disabled={editSaving}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={editSaving}
                onClick={async () => {
                  if (!tenantId || !contract) return;
                  setEditSaving(true);
                  setEditError(null);
                  try {
                    const payload = {
                      dates: {
                        startDate: editForm.dates.startDate,
                        endDate: editForm.dates.endDate,
                      },
                      dueDay: Number(editForm.dueDay) || 0,
                      rentAmount: Number(editForm.rentAmount) || 0,
                      updateRule: {
                        type: editForm.updateRule.type,
                        periodMonths: Number(editForm.updateRule.periodMonths) || 0,
                      },
                      parties: {
                        owner: { ...(editForm.parties?.owner ?? emptyParty) },
                        tenant: { ...(editForm.parties?.tenant ?? emptyParty) },
                      },
                      guaranteeType: editForm.guaranteeType,
                      guaranteeDetails: editForm.guaranteeDetails,
                    } as Partial<ContractRecordWithProperty>;
                    await updateContract(tenantId, contract.id, payload);
                    setContract((prev) =>
                      prev
                        ? {
                            ...prev,
                            ...payload,
                          }
                        : prev
                    );
                    setEditModalOpen(false);
                  } catch (err) {
                    setEditError("No se pudo guardar el contrato.");
                  } finally {
                    setEditSaving(false);
                  }
                }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {editSaving ? (
                  <span className="inline-flex items-center gap-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4 animate-spin"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        className="opacity-75"
                        d="M21 12a9 9 0 0 0-9-9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    Guardando...
                  </span>
                ) : (
                  "Guardar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteModalOpen && contract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 modal-backdrop">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg modal-panel">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                Eliminar contrato
              </h3>
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-3 text-sm text-zinc-600">
              Esto elimina el contrato y lo oculta del listado. Podes
              restaurarlo desde la base si hace falta.
            </p>
            {deleteError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {deleteError}
              </div>
            )}
            <div className="mt-4">
              <label className="block text-xs font-medium text-zinc-700">
                Motivo (opcional)
              </label>
              <input
                type="text"
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                className="mt-2 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                placeholder="Ej: finalizado"
              />
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleteSaving}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleteSaving}
                onClick={async () => {
                  if (!tenantId || !user) return;
                  setDeleteSaving(true);
                  setDeleteError(null);
                  try {
                    const reasonValue = deleteReason.trim();
                    await updateContract(tenantId, contract.id, {
                      status: "deleted",
                      deletedAt: serverTimestamp(),
                      deletedByUid: user.uid,
                      ...(reasonValue ? { deleteReason: reasonValue } : {}),
                    } as Partial<ContractRecordWithProperty>);
                    router.replace("/contracts");
                  } catch (err) {
                    console.error("ContractDetail:delete", err);
                    recordDebugError("contracts:detail:delete", err);
                    setDeleteError("No se pudo eliminar el contrato.");
                  } finally {
                    setDeleteSaving(false);
                  }
                }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
              >
                {deleteSaving ? (
                  <span className="inline-flex items-center gap-2">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4 animate-spin"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        className="opacity-75"
                        d="M21 12a9 9 0 0 0-9-9"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    Eliminando...
                  </span>
                ) : (
                  "Eliminar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
