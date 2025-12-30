"use client";

import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
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
  enabledR1?: boolean;
  enabledR2?: boolean;
};

export type Installment = {
  contractId: string;
  period: string;
  dueDate: Timestamp;
  status: InstallmentStatus;
  totals: InstallmentTotals;
  notificationConfigOverride?: InstallmentNotificationOverride;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type InstallmentItemType =
  | "ALQUILER"
  | "EXPENSAS"
  | "ROTURAS"
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
