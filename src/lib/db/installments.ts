"use client";

import {
  Timestamp,
  Transaction,
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Contract } from "@/lib/model/v1";

export type InstallmentStatus =
  | "POR_VENCER"
  | "VENCE_HOY"
  | "VENCIDA"
  | "EN_ACUERDO"
  | "PARCIAL"
  | "PAGADA";

export type InstallmentTotals = {
  total: number;
  paid: number;
  due: number;
};

export type InstallmentNotificationOverride = {
  enabled?: boolean;
};

export type InstallmentPaymentFlags = {
  hasUnverifiedPayments?: boolean;
};

export type PaymentMethod = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "OTRO";

export type PaymentReceipt = {
  name: string;
  path: string;
  url: string;
};

export type Installment = {
  contractId: string;
  period: string;
  dueDate: Timestamp;
  status: InstallmentStatus;
  totals: InstallmentTotals;
  paymentFlags?: InstallmentPaymentFlags;
  notificationOverride?: InstallmentNotificationOverride;
  agreementNote?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type InstallmentItemType =
  | "ALQUILER"
  | "EXPENSAS"
  | "ROTURAS"
  | "DESCUENTO"
  | "OTROS"
  | "SERVICIOS"
  | "MORA"
  | "AJUSTE"
  | "OTRO";

export type InstallmentItem = {
  type: InstallmentItemType;
  label: string;
  amount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type InstallmentItemRecord = InstallmentItem & { id: string };

export type InstallmentPayment = {
  amount: number;
  paidAt: Timestamp;
  method: PaymentMethod;
  collectedBy: string;
  withoutReceipt: boolean;
  receipt?: PaymentReceipt;
  note?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type InstallmentRecord = Installment & { id: string };

const toDateNumber = (date: Date) =>
  date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();

const parseContractDate = (value: string) => new Date(`${value}T00:00:00`);

const getStatusForDueDate = (dueDate: Date): InstallmentStatus => {
  const todayNumber = toDateNumber(new Date());
  const dueNumber = toDateNumber(dueDate);
  if (dueNumber > todayNumber) return "POR_VENCER";
  if (dueNumber === todayNumber) return "VENCE_HOY";
  return "VENCIDA";
};

const getDueDateFromInstallment = (installment: Installment) => {
  const maybeDate = (installment.dueDate as any)?.toDate?.();
  if (maybeDate instanceof Date) return maybeDate;
  return installment.dueDate instanceof Date ? installment.dueDate : new Date();
};

const recomputeInstallmentTotalsAndStatusTx = async (
  transaction: Transaction,
  tenantId: string,
  installmentId: string
) => {
  const installmentRef = doc(db, "tenants", tenantId, "installments", installmentId);
  const installmentSnap = await transaction.get(installmentRef);
  if (!installmentSnap.exists()) {
    throw new Error("La cuota no existe.");
  }

  const itemsQuery = query(
    collection(db, "tenants", tenantId, "installments", installmentId, "items")
  );
  const itemsSnap = await getDocs(itemsQuery);
  const total = itemsSnap.docs.reduce((sum, itemSnap) => {
    const amount = Number((itemSnap.data() as InstallmentItem).amount ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  const installment = installmentSnap.data() as Installment;
  const paid = Number(installment.totals?.paid ?? 0);
  const due = Math.max(total - paid, 0);
  const updatePayload: Record<string, unknown> = {
    totals: { total, paid, due },
    updatedAt: serverTimestamp(),
  };

  if (installment.status !== "EN_ACUERDO") {
    const dueDate = getDueDateFromInstallment(installment);
    const nextStatus =
      paid >= total
        ? "PAGADA"
        : paid > 0
          ? "PARCIAL"
          : getStatusForDueDate(dueDate);
    updatePayload.status = nextStatus;
  }

  transaction.update(installmentRef, updatePayload);
};

const getMonthPeriods = (startDate: string, endDate: string) => {
  const start = parseContractDate(startDate);
  const end = parseContractDate(endDate);
  let year = start.getFullYear();
  let month = start.getMonth();
  const endYear = end.getFullYear();
  const endMonth = end.getMonth();
  const periods: { year: number; month: number; period: string }[] = [];

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const period = `${year}-${String(month + 1).padStart(2, "0")}`;
    periods.push({ year, month, period });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return periods;
};

export async function generateInstallmentsForContract(
  tenantId: string,
  contract: Contract & { id: string }
) {
  const periods = getMonthPeriods(contract.dates.startDate, contract.dates.endDate);
  const installmentsRef = collection(db, "tenants", tenantId, "installments");

  for (const periodInfo of periods) {
    const { year, month, period } = periodInfo;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const dueDay = Math.min(contract.dueDay, lastDay);
    const dueDate = new Date(year, month, dueDay);
    const status = getStatusForDueDate(dueDate);
    const totals = {
      total: contract.rentAmount,
      paid: 0,
      due: contract.rentAmount,
    };
    const installmentId = `${contract.id}_${period}`;
    const installmentDoc = doc(installmentsRef, installmentId);
    const existing = await getDoc(installmentDoc);
    if (existing.exists()) {
      continue;
    }
    await setDoc(installmentDoc, {
      contractId: contract.id,
      period,
      dueDate: Timestamp.fromDate(dueDate),
      status,
      totals,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const itemsRef = collection(
      db,
      "tenants",
      tenantId,
      "installments",
      installmentId,
      "items"
    );
    await addDoc(itemsRef, {
      type: "ALQUILER",
      label: "Alquiler",
      amount: contract.rentAmount,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } satisfies InstallmentItem);
  }
}

export async function listInstallmentsByContract(
  tenantId: string,
  contractId: string
) {
  const installmentsRef = collection(db, "tenants", tenantId, "installments");
  const q = query(
    installmentsRef,
    where("contractId", "==", contractId),
    orderBy("period", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<Installment, "id">),
  })) as InstallmentRecord[];
}

export async function listInstallmentsForTenant(
  tenantId: string,
  filters?: { status?: InstallmentStatus | "ALL" }
) {
  const installmentsRef = collection(db, "tenants", tenantId, "installments");
  const constraints = [];
  if (filters?.status && filters.status !== "ALL") {
    constraints.push(where("status", "==", filters.status));
  }
  constraints.push(orderBy("dueDate", "asc"));
  constraints.push(limit(100));
  const q = query(installmentsRef, ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<Installment, "id">),
  })) as InstallmentRecord[];
}

export async function listInstallmentsForTenantPage(
  tenantId: string,
  opts?: {
    status?: InstallmentStatus | "ALL";
    pageSize?: number;
    cursor?: any;
  }
): Promise<{
  items: InstallmentRecord[];
  nextCursor: any | null;
}> {
  const installmentsRef = collection(db, "tenants", tenantId, "installments");
  const constraints = [];
  if (opts?.status && opts.status !== "ALL") {
    constraints.push(where("status", "==", opts.status));
  }
  constraints.push(orderBy("dueDate", "asc"));
  if (opts?.cursor) {
    constraints.push(startAfter(opts.cursor));
  }
  constraints.push(limit(opts?.pageSize ?? 25));
  const q = query(installmentsRef, ...constraints);
  const snap = await getDocs(q);
  const items = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<Installment, "id">),
  })) as InstallmentRecord[];
  const nextCursor = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
  return { items, nextCursor };
}

export async function listInstallmentItems(
  tenantId: string,
  installmentId: string
) {
  const itemsRef = collection(
    db,
    "tenants",
    tenantId,
    "installments",
    installmentId,
    "items"
  );
  const q = query(itemsRef, orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as InstallmentItem),
  })) as InstallmentItemRecord[];
}

export async function upsertInstallmentItem(
  tenantId: string,
  installmentId: string,
  item: { id?: string; type: InstallmentItemType; label: string; amount: number }
) {
  const label = item.label.trim();
  if (!label) {
    throw new Error("El concepto es obligatorio.");
  }

  let amount = Number(item.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error("El monto debe ser distinto de 0.");
  }
  if (item.type === "DESCUENTO" && amount > 0) {
    amount = -amount;
  }
  if (item.type !== "DESCUENTO" && amount <= 0) {
    throw new Error("El monto debe ser mayor a 0.");
  }

  const itemsRef = collection(
    db,
    "tenants",
    tenantId,
    "installments",
    installmentId,
    "items"
  );
  const itemRef = item.id ? doc(itemsRef, item.id) : doc(itemsRef);

  await runTransaction(db, async (transaction) => {
    if (item.id) {
      transaction.update(itemRef, {
        type: item.type,
        label,
        amount,
        updatedAt: serverTimestamp(),
      });
    } else {
      transaction.set(itemRef, {
        type: item.type,
        label,
        amount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } satisfies InstallmentItem);
    }

    await recomputeInstallmentTotalsAndStatusTx(
      transaction,
      tenantId,
      installmentId
    );
  });
}

export async function deleteInstallmentItem(
  tenantId: string,
  installmentId: string,
  itemId: string
) {
  const itemRef = doc(
    db,
    "tenants",
    tenantId,
    "installments",
    installmentId,
    "items",
    itemId
  );
  await runTransaction(db, async (transaction) => {
    transaction.delete(itemRef);
    await recomputeInstallmentTotalsAndStatusTx(
      transaction,
      tenantId,
      installmentId
    );
  });
}

export async function setInstallmentAgreementStatus(
  tenantId: string,
  installmentId: string,
  enabled: boolean,
  note?: string
) {
  const installmentRef = doc(db, "tenants", tenantId, "installments", installmentId);
  const noteValue = note?.trim();

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(installmentRef);
    if (!snap.exists()) {
      throw new Error("La cuota no existe.");
    }

    const data = snap.data() as Installment;
    const updatePayload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };

    if (enabled) {
      updatePayload.status = "EN_ACUERDO";
      if (noteValue) {
        updatePayload.agreementNote = noteValue;
      }
    } else {
      const totals = data.totals ?? { total: 0, paid: 0, due: 0 };
      const total = Number(totals.total ?? 0);
      const paid = Number(totals.paid ?? 0);
      const dueDate = getDueDateFromInstallment(data);
      const nextStatus =
        paid >= total
          ? "PAGADA"
          : paid > 0
            ? "PARCIAL"
            : getStatusForDueDate(dueDate);
      updatePayload.status = nextStatus;
      updatePayload.agreementNote = deleteField();
    }

    transaction.update(installmentRef, updatePayload);
  });
}

export async function addLateFeeItem(
  tenantId: string,
  installmentId: string,
  amount: number
) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("El monto de mora debe ser mayor a 0.");
  }

  await upsertInstallmentItem(tenantId, installmentId, {
    type: "MORA",
    label: "Mora",
    amount,
  });
}

export async function registerInstallmentPayment(
  tenantId: string,
  installmentId: string,
  input: {
    amount: number;
    withoutReceipt: boolean;
    paidAt?: Date | string;
    method: PaymentMethod;
    note?: string;
    receipt?: PaymentReceipt;
    collectedBy: string;
  }
) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("El monto del pago debe ser mayor a 0.");
  }

  if (!input.method) {
    throw new Error("El medio de pago es obligatorio.");
  }

  if (!input.collectedBy) {
    throw new Error("El cobrador es obligatorio.");
  }

  const installmentRef = doc(db, "tenants", tenantId, "installments", installmentId);
  const paymentRef = doc(
    collection(db, "tenants", tenantId, "installments", installmentId, "payments")
  );
  const noteValue = input.note?.trim();
  const paidAtValue =
    input.paidAt instanceof Date
      ? input.paidAt
      : input.paidAt
        ? new Date(input.paidAt)
        : new Date();
  if (!Number.isFinite(paidAtValue.getTime())) {
    throw new Error("La fecha de pago es invalida.");
  }

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(installmentRef);
    if (!snap.exists()) {
      throw new Error("La cuota no existe.");
    }

    const data = snap.data() as Installment;
    const totals = data.totals ?? { total: 0, paid: 0, due: 0 };
    const total = Number(totals.total ?? 0);
    const paid = Number(totals.paid ?? 0);
    const newPaid = paid + input.amount;
    const newDue = Math.max(total - newPaid, 0);
    const dueDate = getDueDateFromInstallment(data);
    const newStatus =
      newPaid >= total
        ? "PAGADA"
        : newPaid > 0
          ? "PARCIAL"
          : getStatusForDueDate(dueDate);

    const updatePayload: Record<string, unknown> = {
      "totals.paid": newPaid,
      "totals.due": newDue,
      status: newStatus,
      updatedAt: serverTimestamp(),
    };
    if (input.withoutReceipt) {
      updatePayload["paymentFlags.hasUnverifiedPayments"] = true;
    }

    transaction.update(installmentRef, updatePayload);
    transaction.set(paymentRef, {
      amount: input.amount,
      paidAt: Timestamp.fromDate(paidAtValue),
      method: input.method,
      collectedBy: input.collectedBy,
      withoutReceipt: input.withoutReceipt,
      ...(!input.withoutReceipt && input.receipt ? { receipt: input.receipt } : {}),
      ...(noteValue ? { note: noteValue } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } satisfies InstallmentPayment);
  });
}

export async function markInstallmentPaidWithoutReceipt(
  tenantId: string,
  installmentId: string,
  collectedBy: string,
  note?: string
) {
  const installmentRef = doc(db, "tenants", tenantId, "installments", installmentId);
  const paymentRef = doc(
    collection(db, "tenants", tenantId, "installments", installmentId, "payments")
  );
  const noteValue = note?.trim() || "Marcada pagada sin comprobante";

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(installmentRef);
    if (!snap.exists()) {
      throw new Error("La cuota no existe.");
    }

    const data = snap.data() as Installment;
    const total = Number(data.totals?.total ?? 0);
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error("Total inválido para marcar pagada.");
    }
    const paidPrev = Number(data.totals?.paid ?? 0);
    const missing = Math.max(total - paidPrev, 0);

    transaction.update(installmentRef, {
      "totals.paid": total,
      "totals.due": 0,
      status: "PAGADA",
      "paymentFlags.hasUnverifiedPayments": true,
      updatedAt: serverTimestamp(),
    });

    if (missing > 0) {
      transaction.set(paymentRef, {
        amount: missing,
        paidAt: Timestamp.fromDate(new Date()),
        method: "OTRO",
        collectedBy,
        withoutReceipt: true,
        note: noteValue,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } satisfies InstallmentPayment);
    }
  });
}
