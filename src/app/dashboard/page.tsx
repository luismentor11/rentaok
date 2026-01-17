"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { listContracts, ContractRecord } from "@/lib/db/contracts";
import {
  listInstallmentsForTenant,
  setInstallmentAgreementStatus,
  registerInstallmentPayment,
  upsertInstallmentItem,
  InstallmentRecord,
  InstallmentStatus,
  InstallmentItemType,
  PaymentMethod,
} from "@/lib/db/installments";
import { uploadPaymentReceipt } from "@/lib/storage/payments";
import {
  buildTenantNotificationMessage,
  getNotificationDueToday,
} from "@/lib/db/notifications";
import { recordAiError, recordDebugError } from "@/lib/debug";
import { toDateSafe } from "@/lib/utils/firestoreDate";
import { db } from "@/lib/firebase";

const statusOptions: { value: InstallmentStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "POR_VENCER", label: "Por vencer" },
  { value: "VENCE_HOY", label: "Vence hoy" },
  { value: "VENCIDA", label: "Vencida" },
  { value: "EN_ACUERDO", label: "En acuerdo" },
  { value: "PARCIAL", label: "Parcial" },
  { value: "PAGADA", label: "Pagada" },
];

const additionalItemTypes: { value: InstallmentItemType; label: string }[] = [
  { value: "EXPENSAS", label: "Expensas" },
  { value: "ROTURAS", label: "Roturas" },
  { value: "OTROS", label: "Otros" },
  { value: "DESCUENTO", label: "Descuento" },
];

const assistableAlertTypes: AssistAlertType[] = [
  "VENCIDA",
  "VENCE_HOY",
  "PARCIAL",
  "EN_ACUERDO",
  "SIN_RECIBO",
];

type PaymentMirrorRecord = {
  id: string;
  installmentId?: string;
  contractId?: string;
  paidAt?: unknown;
  metadata?: { overpay?: number };
};

type AlertType =
  | "VENCIDA"
  | "VENCE_HOY"
  | "POR_VENCER"
  | "PARCIAL"
  | "EN_ACUERDO"
  | "SIN_RECIBO"
  | "OVERPAY"
  | "DATOS";

type AlertItem = {
  type: AlertType;
  title: string;
  detail: string;
  href: string;
  priority: number;
  createdAt: number;
  contractId?: string;
  installmentId?: string;
};

type AssistAlertType = "VENCIDA" | "VENCE_HOY" | "PARCIAL" | "EN_ACUERDO" | "SIN_RECIBO";
type AssistTone = "formal" | "neutro" | "corto";

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const buildAlerts = (params: {
  installments: InstallmentRecord[];
  contractsById: Record<string, ContractRecord>;
  payments: PaymentMirrorRecord[];
}) => {
  const { installments, contractsById, payments } = params;
  const today = new Date();
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  const overpayInstallments = new Set<string>();
  payments.forEach((payment) => {
    if (payment.installmentId && (payment.metadata?.overpay ?? 0) > 0) {
      overpayInstallments.add(payment.installmentId);
    }
  });

  const alerts: AlertItem[] = [];

  installments.forEach((installment) => {
    const dueDate = toDateSafe(installment.dueDate);
    const dueTime = dueDate ? dueDate.getTime() : Date.now();
    const contractId = installment.contractId ?? "";
    const installmentId = installment.id;
    const contract = contractId ? contractsById[contractId] : undefined;
    const contractLabel =
      contract?.property?.title ?? contract?.property?.address ?? "Contrato";
    const periodLabel = installment.period ? `Periodo ${installment.period}` : "Periodo";
    const href = contractId ? `/contracts/${contractId}` : "/contracts";
    const detail = `${contractLabel} • ${periodLabel}`;

    const isOverdue =
      installment.status === "VENCIDA" ||
      (dueDate ? dueDate < today : false) ||
      false;
    if (isOverdue && Number(installment.totals?.due ?? 0) > 0) {
      alerts.push({
        type: "VENCIDA",
        title: "Cuota vencida",
        detail,
        href,
        priority: 1,
        createdAt: dueTime,
        contractId,
        installmentId,
      });
    }

    if (dueDate && (installment.status === "VENCE_HOY" || isSameDay(dueDate, today))) {
      alerts.push({
        type: "VENCE_HOY",
        title: "Vence hoy",
        detail,
        href,
        priority: 2,
        createdAt: dueTime,
        contractId,
        installmentId,
      });
    }

    if (
      dueDate &&
      installment.status === "POR_VENCER" &&
      dueDate <= nextWeek &&
      dueDate >= today
    ) {
      alerts.push({
        type: "POR_VENCER",
        title: "Vence en los próximos días",
        detail,
        href,
        priority: 5,
        createdAt: dueTime,
        contractId,
        installmentId,
      });
    }

    if (installment.status === "PARCIAL" && Number(installment.totals?.due ?? 0) > 0) {
      alerts.push({
        type: "PARCIAL",
        title: "Pago parcial pendiente",
        detail,
        href,
        priority: 3,
        createdAt: dueTime,
        contractId,
        installmentId,
      });
    }

    if (installment.status === "EN_ACUERDO") {
      alerts.push({
        type: "EN_ACUERDO",
        title: "Acuerdo activo",
        detail,
        href,
        priority: 4,
        createdAt: dueTime,
        contractId,
        installmentId,
      });
    }

    if (installment.paymentFlags?.hasUnverifiedPayments) {
      alerts.push({
        type: "SIN_RECIBO",
        title: "Pago sin recibo",
        detail,
        href,
        priority: 6,
        createdAt: dueTime,
        contractId,
        installmentId,
      });
    }

    if (installment.id && overpayInstallments.has(installment.id)) {
      alerts.push({
        type: "OVERPAY",
        title: "Pago con excedente",
        detail,
        href,
        priority: 7,
        createdAt: dueTime,
        contractId,
        installmentId,
      });
    }

    if (contractId && !contractsById[contractId]) {
      alerts.push({
        type: "DATOS",
        title: "Datos incompletos",
        detail,
        href,
        priority: 8,
        createdAt: dueTime,
        contractId,
        installmentId,
      });
    }
  });

  return alerts
    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)
    .slice(0, 10);
};

export default function OperationalDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [contractsById, setContractsById] = useState<
    Record<string, ContractRecord>
  >({});
  const [statusFilter, setStatusFilter] = useState<
    InstallmentStatus | "ALL"
  >("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [installments, setInstallments] = useState<InstallmentRecord[]>([]);
  const [installmentsLoading, setInstallmentsLoading] = useState(false);
  const [installmentsError, setInstallmentsError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentMirrorRecord[]>([]);
  const [actionLoading, setActionLoading] = useState<
    Record<string, { agreement?: boolean }>
  >({});

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

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemInstallment, setItemInstallment] =
    useState<InstallmentRecord | null>(null);
  const [itemType, setItemType] = useState<InstallmentItemType>("EXPENSAS");
  const [itemLabel, setItemLabel] = useState("");
  const [itemAmount, setItemAmount] = useState("");
  const [itemSubmitting, setItemSubmitting] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);

  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [messageContractId, setMessageContractId] = useState<string | null>(null);
  const [messageRecipient, setMessageRecipient] = useState<
    "tenant" | "guarantors" | "both"
  >("tenant");
  const [messageChannel, setMessageChannel] = useState<
    "whatsapp" | "email" | "copy"
  >("whatsapp");
  const [messageText, setMessageText] = useState("");
  const [messageSubmitting, setMessageSubmitting] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [assistModalOpen, setAssistModalOpen] = useState(false);
  const [assistTarget, setAssistTarget] = useState<{
    type: AssistAlertType;
    contractId: string;
    installmentId?: string | null;
  } | null>(null);
  const [assistTone, setAssistTone] = useState<AssistTone>("neutro");
  const [assistBody, setAssistBody] = useState("");
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistLoading, setAssistLoading] = useState(false);
  const [assistCopied, setAssistCopied] = useState(false);

  const statusBadgeColor: Record<InstallmentStatus, string> = {
    POR_VENCER: "bg-success/15 text-success",
    VENCE_HOY: "bg-warning/15 text-warning",
    VENCIDA: "bg-danger/15 text-danger",
    EN_ACUERDO: "bg-risk/15 text-risk",
    PARCIAL: "bg-warning/15 text-warning",
    PAGADA: "bg-success/15 text-success",
  };

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
      setError(null);
      try {
        const tokenResult = await user.getIdTokenResult();
        if (!active) return;
        const nextTenantId =
          typeof tokenResult.claims?.tenantId === "string"
            ? tokenResult.claims.tenantId
            : null;
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          return;
        }
        const contractList = await listContracts(nextTenantId);
        if (!active) return;
        setContractsById(
          Object.fromEntries(contractList.map((contract) => [contract.id, contract]))
        );
      } catch (err: any) {
        if (!active) return;
        setError(err?.message ?? "No se pudo cargar el dashboard.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [user, loading, router]);

  const loadInstallments = async (tenant: string) => {
    setInstallmentsLoading(true);
    setInstallmentsError(null);
    try {
      const params = statusFilter === "ALL" ? {} : { status: statusFilter };
      const list = await listInstallmentsForTenant(tenant, params);
      setInstallments(list);
    } catch (err: any) {
      const message = err?.message ?? "No se pudieron cargar cuotas.";
      console.error("Dashboard:installments", err);
      recordDebugError("dashboard:installments", err);
      setInstallmentsError(message);
      try {
        localStorage.setItem(
          "debug:lastInstallmentsError",
          JSON.stringify({
            message,
            statusFilter,
            tenantId,
            ts: Date.now(),
          })
        );
      } catch {}
    } finally {
      setInstallmentsLoading(false);
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    loadInstallments(tenantId);
  }, [tenantId, statusFilter]);

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    const loadPayments = async () => {
      try {
        const paymentsRef = collection(db, "tenants", tenantId, "payments");
        const snap = await getDocs(query(paymentsRef, limit(200)));
        if (!active) return;
        setPayments(
          snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<PaymentMirrorRecord, "id">),
          }))
        );
      } catch (err) {
        console.error("Dashboard:payments", err);
        recordDebugError("dashboard:payments", err);
        if (!active) return;
        setPayments([]);
      }
    };
    loadPayments();
    return () => {
      active = false;
    };
  }, [tenantId]);

  const toDateTimeInputValue = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const formatDueDate = (value: InstallmentRecord["dueDate"]) => {
    const date = toDateSafe(value);
    return date ? date.toLocaleDateString() : "-";
  };

  const getOperationalWindow = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    if (today.getDate() >= 10) {
      const start = new Date(year, month, 10, 0, 0, 0, 0);
      const end = new Date(year, month + 1, 10, 23, 59, 59, 999);
      return { start, end };
    }
    const start = new Date(year, month - 1, 10, 0, 0, 0, 0);
    const end = new Date(year, month, 10, 23, 59, 59, 999);
    return { start, end };
  };

  const filteredInstallments = useMemo(() => {
    const { start, end } = getOperationalWindow();
    const windowed = installments.filter((installment) => {
      const dueDate = toDateSafe(installment.dueDate);
      if (!dueDate) return false;
      return dueDate >= start && dueDate <= end;
    });
    const term = searchTerm.trim().toLowerCase();
    if (!term) return windowed;
    return windowed.filter((installment) => {
      const haystack = `${installment.contractId} ${installment.period} ${installment.status}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [installments, searchTerm]);

  const alertsError = installmentsError
    ? "No pudimos cargar próximas acciones. Reintentá."
    : null;

  const alerts = useMemo(() => {
    try {
      return buildAlerts({ installments, contractsById, payments });
    } catch (err) {
      console.error("Dashboard:alerts", err);
      recordDebugError("dashboard:alerts", err);
      return [];
    }
  }, [installments, contractsById, payments]);

  const kpis = useMemo(() => {
    const counts = filteredInstallments.reduce(
      (acc, item) => {
        acc.total += 1;
        acc.due += Number(item.totals?.due ?? 0);
        acc.paid += Number(item.totals?.paid ?? 0);
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
      },
      {
        total: 0,
        due: 0,
        paid: 0,
        POR_VENCER: 0,
        VENCE_HOY: 0,
        VENCIDA: 0,
        EN_ACUERDO: 0,
        PARCIAL: 0,
        PAGADA: 0,
      } as Record<string, number>
    );

    return [
      {
        label: "Vencimientos activos",
        value: String(counts.total),
        tone: "bg-surface-alt text-text",
        onClick: () => setStatusFilter("ALL"),
      },
      {
        label: "Saldo pendiente",
        value: String(counts.due),
        tone: "bg-danger/15 text-danger",
      },
      {
        label: "Cobrado",
        value: String(counts.paid),
        tone: "bg-success/15 text-success",
      },
      {
        label: "En gestion",
        value: String(counts.EN_ACUERDO),
        tone: "bg-risk/15 text-risk",
        onClick: () => setStatusFilter("EN_ACUERDO"),
      },
    ];
  }, [filteredInstallments]);

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

  const openItemModal = (installment: InstallmentRecord) => {
    setItemInstallment(installment);
    setItemType("EXPENSAS");
    setItemLabel("");
    setItemAmount("");
    setItemError(null);
    setItemModalOpen(true);
  };

  const closeItemModal = () => {
    if (itemSubmitting) return;
    setItemModalOpen(false);
    setItemInstallment(null);
  };

  const openMessageModal = (contractId: string) => {
    setMessageContractId(contractId);
    setMessageRecipient("tenant");
    setMessageChannel("whatsapp");
    setMessageText("");
    setMessageError(null);
    setMessageModalOpen(true);
  };

  const closeMessageModal = () => {
    if (messageSubmitting) return;
    setMessageModalOpen(false);
    setMessageContractId(null);
  };

  const requestAssistMessage = async (input: {
    type: AssistAlertType;
    contractId: string;
    installmentId?: string | null;
    tone: AssistTone;
  }) => {
    if (!user) {
      setAssistError("No pudimos generar el mensaje. Reintenta.");
      return;
    }
    setAssistLoading(true);
    setAssistError(null);
    setAssistCopied(false);
    setAssistBody("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/ai/actions/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: input.type,
          contractId: input.contractId,
          ...(input.installmentId ? { installmentId: input.installmentId } : {}),
          tone: input.tone,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok || typeof payload?.body !== "string") {
        throw new Error("assist_message_failed");
      }
      setAssistBody(payload.body);
    } catch (err) {
      console.error("Dashboard:assist-message", err);
      recordAiError("dashboard:assist-message", err);
      setAssistError("No pudimos generar el mensaje. Reintenta.");
    } finally {
      setAssistLoading(false);
    }
  };

  const openAssistModal = (alert: AlertItem) => {
    if (!alert.contractId) return;
    if (!assistableAlertTypes.includes(alert.type as AssistAlertType)) return;
    const nextTone: AssistTone = "neutro";
    setAssistTone(nextTone);
    setAssistTarget({
      type: alert.type as AssistAlertType,
      contractId: alert.contractId,
      installmentId: alert.installmentId ?? null,
    });
    setAssistBody("");
    setAssistError(null);
    setAssistCopied(false);
    setAssistModalOpen(true);
    void requestAssistMessage({
      type: alert.type as AssistAlertType,
      contractId: alert.contractId,
      installmentId: alert.installmentId ?? null,
      tone: nextTone,
    });
  };

  const closeAssistModal = () => {
    if (assistLoading) return;
    setAssistModalOpen(false);
    setAssistTarget(null);
  };

  if (loading || pageLoading) {
    return <div className="text-sm text-text-muted">Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
        No se pudo cargar el panel.
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted">
        <div>
          Tu cuenta no está vinculada a una oficina. Andá a “Oficinas” para
          crear o solicitar acceso.
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Link
            href="/tenants"
            className="text-xs font-medium text-text hover:text-text-muted"
          >
            Ir a Oficinas
          </Link>
          <Link
            href="/debug"
            className="text-xs text-text-muted hover:text-text"
          >
            Ver debug
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Acciones rapidas
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href="/contracts/new"
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-xs font-semibold text-text transition hover:bg-surface flex items-center gap-2"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M12 12v6" />
              <path d="M9 15h6" />
            </svg>
            Cargar contrato
          </Link>
          <button
            type="button"
            onClick={() => router.push("/canones")}
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-xs font-semibold text-text transition hover:bg-surface flex items-center gap-2"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 10h18" />
              <path d="M7 15h3" />
            </svg>
            Registrar pago
          </button>
          <a
            href="https://arquiler.com/"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-xs font-semibold text-text transition hover:bg-surface flex items-center gap-2"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 17l6-6 4 4 7-7" />
              <path d="M21 7v6h-6" />
            </svg>
            Indices
          </a>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-text">Panel operativo</h1>
            <p className="text-sm text-text-muted">
              Estado general de cobros y vencimientos.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            onClick={kpi.onClick}
            className={[
              "rounded-xl border border-border bg-surface p-4",
              kpi.onClick ? "cursor-pointer transition hover:bg-surface-alt" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>{kpi.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${kpi.tone}`}>
                KPI
              </span>
            </div>
            <div className="mt-3 text-2xl font-semibold text-text">
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="text-sm font-semibold text-text">Próximas acciones</div>
        {alertsError ? (
          <div className="mt-2 text-sm text-text-muted">{alertsError}</div>
        ) : alerts.length === 0 ? (
          <div className="mt-2 text-sm text-text-muted">
            No hay acciones urgentes.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {alerts.map((alert, index) => {
              const canAssist =
                alert.contractId &&
                assistableAlertTypes.includes(alert.type as AssistAlertType);
              return (
                <div
                  key={`${alert.type}-${alert.href}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text transition hover:bg-surface"
                >
                  <Link href={alert.href} className="flex-1">
                    <div className="font-semibold">{alert.title}</div>
                    <div className="text-xs text-text-muted">{alert.detail}</div>
                  </Link>
                  {canAssist && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openAssistModal(alert);
                      }}
                      className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-text hover:bg-surface"
                    >
                      Asistir
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col">
          <label className="text-xs font-medium text-text-muted">Estado</label>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as InstallmentStatus | "ALL")
            }
            className="mt-1 rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col">
          <label className="text-xs font-medium text-text-muted">
            Busqueda
          </label>
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
            placeholder="Buscar por periodo o contrato"
          />
        </div>
      </div>

      {installmentsError && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          No se pudieron cargar los vencimientos.
        </div>
      )}

      {installmentsLoading ? (
        <div className="text-sm text-text-muted">Cargando cuotas...</div>
      ) : filteredInstallments.length === 0 ? (
        <div className="space-y-1">
          <div className="text-sm text-text-muted">
            No hay vencimientos para mostrar.
          </div>
          <div className="text-xs text-text-muted">Carga tu primer contrato.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredInstallments.map((installment) => {
            const contract = contractsById[installment.contractId];
            const tenantEmail = contract?.parties.tenant.email?.trim() ?? "";
            const contractNotificationsEnabled = Boolean(
              contract?.notificationConfig?.enabled
            );
            const overrideEnabled = installment.notificationOverride?.enabled;
            const notifyEnabled =
              overrideEnabled !== undefined
                ? overrideEnabled
                : contractNotificationsEnabled;
            const dueType = getNotificationDueToday(installment, new Date());
            const notifyDisabled =
              !notifyEnabled || !tenantEmail || !dueType || !contract;
            const notifyTooltip = !contract
              ? "Contrato no cargado"
              : !contractNotificationsEnabled && overrideEnabled !== true
                ? "Notificaciones desactivadas"
                : !tenantEmail
                  ? "Sin email del inquilino"
                  : !dueType
                    ? "No corresponde notificacion hoy"
                    : "";

            return (
              <div
                key={installment.id}
                className="rounded-xl border border-border bg-surface p-4 text-sm text-text"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-text">
                      Periodo {installment.period}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      Vencimiento {formatDueDate(installment.dueDate)}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold ${statusBadgeColor[installment.status]}`}
                      >
                        {installment.status}
                      </span>
                      <span className="rounded-full bg-surface-alt px-2 py-0.5 font-medium text-text-muted">
                        Total {installment.totals.total}
                      </span>
                      <span className="rounded-full bg-surface-alt px-2 py-0.5 font-medium text-text-muted">
                        Pagado {installment.totals.paid}
                      </span>
                      <span className="rounded-full bg-surface-alt px-2 py-0.5 font-medium text-text-muted">
                        Adeudado {installment.totals.due}
                      </span>
                    </div>
                  </div>
                  <Link
                    href={`/contracts/${installment.contractId}`}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-alt"
                  >
                    Abrir contrato
                  </Link>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openPaymentModal(installment)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-alt"
                  >
                    Registrar cobro
                  </button>
                  <button
                    type="button"
                    onClick={() => openItemModal(installment)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-alt"
                  >
                    Agregar item
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading[installment.id]?.agreement}
                    onClick={async () => {
                      if (!tenantId) return;
                      const isAgreement = installment.status === "EN_ACUERDO";
                      if (isAgreement) {
                        const ok = window.confirm(
                          "Quitar acuerdo y recalcular estado?"
                        );
                        if (!ok) return;
                      }
                      const note = !isAgreement
                        ? window.prompt("Nota del acuerdo (opcional):") ?? null
                        : null;
                      if (!isAgreement && note === null) return;
                      setActionLoading((prev) => ({
                        ...prev,
                        [installment.id]: {
                          ...prev[installment.id],
                          agreement: true,
                        },
                      }));
                      setInstallmentsError(null);
                      try {
                        await setInstallmentAgreementStatus(
                          tenantId,
                          installment.id,
                          !isAgreement,
                          note ?? undefined
                        );
                        await loadInstallments(tenantId);
                      } catch (err: any) {
                        setInstallmentsError(
                          err?.message ?? "No se pudo actualizar el acuerdo."
                        );
                      } finally {
                        setActionLoading((prev) => ({
                          ...prev,
                          [installment.id]: {
                            ...prev[installment.id],
                            agreement: false,
                          },
                        }));
                      }
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-text-muted"
                  >
                    {installment.status === "EN_ACUERDO"
                      ? "Quitar acuerdo"
                      : "Registrar acuerdo"}
                  </button>
                  <button
                    type="button"
                    disabled={notifyDisabled}
                    title={notifyDisabled ? notifyTooltip : "Reenviar email"}
                    onClick={() => {
                      if (notifyDisabled || !contract || !dueType) return;
                      const message = buildTenantNotificationMessage({
                        installment,
                        contractId: installment.contractId,
                        dueType,
                      });
                      const href = `mailto:${tenantEmail}?subject=${encodeURIComponent(
                        message.subject
                      )}&body=${encodeURIComponent(message.body)}`;
                      window.open(href, "_blank");
                    }}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-text-muted"
                  >
                    Reenviar notificacion
                  </button>
                  <button
                    type="button"
                    onClick={() => openMessageModal(installment.contractId)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-alt"
                  >
                    Enviar mensaje
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {paymentModalOpen && paymentInstallment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">
                Registrar cobro
              </h3>
              <button
                type="button"
                onClick={closePaymentModal}
                className="text-sm text-text-muted hover:text-text"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Periodo {paymentInstallment.period} - Total{" "}
              {paymentInstallment.totals.total}
            </p>
            {paymentError && (
              <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {paymentError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-text">
                  Monto pagado
                </label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                  placeholder="1000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text">
                  Fecha y hora
                </label>
                <input
                  type="datetime-local"
                  value={paymentPaidAt}
                  onChange={(event) => setPaymentPaidAt(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text">
                  Medio de pago
                </label>
                <select
                  value={paymentMethod}
                  onChange={(event) =>
                    setPaymentMethod(event.target.value as PaymentMethod)
                  }
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                >
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                  <option value="TARJETA">Tarjeta</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-text">
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
                <label className="block text-sm font-medium text-text">
                  Comprobante (opcional)
                </label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  disabled={paymentWithoutReceipt}
                  onChange={(event) =>
                    setPaymentReceiptFile(event.target.files?.[0] ?? null)
                  }
                  className="mt-2 w-full text-sm text-text file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-alt file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-text hover:file:bg-surface disabled:cursor-not-allowed disabled:text-text-muted"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text">
                  Nota (opcional)
                </label>
                <textarea
                  rows={2}
                  value={paymentNote}
                  onChange={(event) => setPaymentNote(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                  placeholder="Pago en efectivo"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closePaymentModal}
                disabled={paymentSubmitting}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-text-muted"
              >
                Cancelar
              </button>
                <button
                  type="button"
                  disabled={paymentSubmitting}
                  onClick={async () => {
                    if (paymentSubmitting) return;
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
                    await loadInstallments(tenantId);
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
                className="rounded-md bg-surface-alt px-3 py-1.5 text-sm font-medium text-text hover:bg-surface disabled:cursor-not-allowed disabled:bg-surface"
              >
                {paymentSubmitting ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {itemModalOpen && itemInstallment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">
                Agregar item
              </h3>
              <button
                type="button"
                onClick={closeItemModal}
                className="text-sm text-text-muted hover:text-text"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Periodo {itemInstallment.period}
            </p>
            {itemError && (
              <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {itemError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-text">
                  Tipo
                </label>
                <select
                  value={itemType}
                  onChange={(event) =>
                    setItemType(event.target.value as InstallmentItemType)
                  }
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                >
                  {additionalItemTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text">
                  Concepto
                </label>
                <input
                  type="text"
                  value={itemLabel}
                  onChange={(event) => setItemLabel(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                  placeholder="Ej: Expensas marzo"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text">
                  Monto
                </label>
                <input
                  type="number"
                  value={itemAmount}
                  onChange={(event) => setItemAmount(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                  placeholder="1000"
                />
                {itemType === "DESCUENTO" && (
                  <div className="mt-1 text-[11px] text-text-muted">
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
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-text-muted"
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
                        type: itemType,
                        label: labelValue,
                        amount: amountValue,
                      }
                    );
                    await loadInstallments(tenantId);
                    setItemModalOpen(false);
                    setItemInstallment(null);
                  } catch (err: any) {
                    setItemError(
                      err?.message ?? "No se pudo guardar el item."
                    );
                  } finally {
                    setItemSubmitting(false);
                  }
                }}
                className="rounded-md bg-surface-alt px-3 py-1.5 text-sm font-medium text-text hover:bg-surface disabled:cursor-not-allowed disabled:bg-surface"
              >
                {itemSubmitting ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {assistModalOpen && assistTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Mensaje sugerido</h3>
              <button
                type="button"
                onClick={closeAssistModal}
                disabled={assistLoading}
                className="text-sm text-text-muted hover:text-text disabled:text-text-muted/60"
              >
                Cerrar
              </button>
            </div>
            {assistError && (
              <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {assistError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-text">
                  Tono
                </label>
                <select
                  value={assistTone}
                  onChange={(event) =>
                    setAssistTone(event.target.value as AssistTone)
                  }
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                >
                  <option value="corto">Corto</option>
                  <option value="neutro">Neutro</option>
                  <option value="formal">Formal</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text">
                  Cuerpo
                </label>
                <textarea
                  rows={6}
                  value={assistBody}
                  readOnly
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                  placeholder={assistLoading ? "Generando mensaje..." : ""}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={assistLoading || !assistTarget}
                  onClick={() => {
                    if (!assistTarget) return;
                    void requestAssistMessage({
                      ...assistTarget,
                      tone: assistTone,
                    });
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-text-muted"
                >
                  {assistLoading ? "Generando..." : "Actualizar"}
                </button>
                <button
                  type="button"
                  disabled={!assistBody || assistLoading}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(assistBody);
                      setAssistCopied(true);
                    } catch (err) {
                      console.error("Dashboard:assist-copy", err);
                      setAssistError("No pudimos copiar el mensaje.");
                    }
                  }}
                  className="rounded-md bg-surface-alt px-3 py-1.5 text-sm font-medium text-text hover:bg-surface disabled:cursor-not-allowed disabled:bg-surface"
                >
                  {assistCopied ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {messageModalOpen && messageContractId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">
                Enviar mensaje
              </h3>
              <button
                type="button"
                onClick={closeMessageModal}
                className="text-sm text-text-muted hover:text-text"
              >
                Cerrar
              </button>
            </div>
            {messageError && (
              <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {messageError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-text">
                  Destinatario
                </label>
                <select
                  value={messageRecipient}
                  onChange={(event) =>
                    setMessageRecipient(
                      event.target.value as "tenant" | "guarantors" | "both"
                    )
                  }
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                >
                  <option value="tenant">Locatario</option>
                  <option value="guarantors">Garantes</option>
                  <option value="both">Ambos</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text">
                  Canal
                </label>
                <select
                  value={messageChannel}
                  onChange={(event) =>
                    setMessageChannel(
                      event.target.value as "whatsapp" | "email" | "copy"
                    )
                  }
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="copy">Copiar texto</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text">
                  Texto libre
                </label>
                <textarea
                  rows={3}
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
                  placeholder="Escribe el mensaje"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeMessageModal}
                disabled={messageSubmitting}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-text-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={messageSubmitting}
                onClick={async () => {
                  if (!tenantId || !messageContractId) return;
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
                        messageContractId,
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
                    setMessageContractId(null);
                  } catch (err: any) {
                    setMessageError(
                      err?.message ?? "No se pudo registrar el mensaje."
                    );
                  } finally {
                    setMessageSubmitting(false);
                  }
                }}
                className="rounded-md bg-surface-alt px-3 py-1.5 text-sm font-medium text-text hover:bg-surface disabled:cursor-not-allowed disabled:bg-surface"
              >
                {messageSubmitting ? "Guardando..." : "Registrar mensaje"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
