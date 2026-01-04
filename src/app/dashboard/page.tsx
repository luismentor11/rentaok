"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
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
        const profile = await getUserProfile(user.uid);
        if (!active) return;
        const nextTenantId = profile?.tenantId ?? null;
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          router.replace("/onboarding");
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
      const list = await listInstallmentsForTenant(tenant, {
        status: statusFilter,
      });
      setInstallments(list);
    } catch (err: any) {
      setInstallmentsError(
        err?.message ?? "No se pudieron cargar cuotas."
      );
    } finally {
      setInstallmentsLoading(false);
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    loadInstallments(tenantId);
  }, [tenantId, statusFilter]);

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

  const filteredInstallments = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return installments;
    return installments.filter((installment) => {
      const haystack = `${installment.contractId} ${installment.period} ${installment.status}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [installments, searchTerm]);

  const kpis = useMemo(() => {
    const counts = installments.reduce(
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
      },
    ];
  }, [installments]);

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
        <div>Necesitas crear un tenant para continuar.</div>
        <Link
          href="/onboarding"
          className="mt-2 inline-flex text-xs font-medium text-text hover:text-text-muted"
        >
          Ir a onboarding
        </Link>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="text-xs font-semibold text-text-muted">
          Acciones rapidas
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/contracts/new"
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-xs font-semibold text-text hover:bg-surface"
          >
            + Cargar contrato
          </Link>
          <button
            type="button"
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-xs font-semibold text-text hover:bg-surface"
          >
            Registrar pago
          </button>
          <Link
            href="/contracts"
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-xs font-semibold text-text hover:bg-surface"
          >
            Ver contratos
          </Link>
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
            className="rounded-xl border border-border bg-surface p-4"
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
