import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import * as functions from "firebase-functions";

type ContractDates = {
  startDate?: string | Timestamp;
  endDate?: string | Timestamp;
};

type ContractData = {
  dates?: ContractDates;
  dueDay?: number;
  rentAmount?: number;
};

const toDate = (value?: string | Timestamp) => {
  if (!value) return null;
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateNumber = (date: Date) =>
  date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();

const getStatusForDueDate = (dueDate: Date) => {
  const todayNumber = toDateNumber(new Date());
  const dueNumber = toDateNumber(dueDate);
  if (dueNumber > todayNumber) return "POR_VENCER";
  if (dueNumber === todayNumber) return "VENCE_HOY";
  return "VENCIDA";
};

const getMonthPeriods = (startDate: Date, endDate: Date) => {
  let year = startDate.getFullYear();
  let month = startDate.getMonth();
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth();
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

export const onContractCreated = functions.firestore
  .document("tenants/{tenantId}/contracts/{contractId}")
  .onCreate(async (snap: any, ctx: any) => {
    const db = getFirestore();
    const data = snap.data() as ContractData | undefined;
    const tenantId = ctx.params.tenantId;
    const contractId = ctx.params.contractId;

    if (!data) {
      console.warn("[onContractCreated] Missing contract data", {
        tenantId,
        contractId,
      });
      return;
    }

    const startDate = toDate(data.dates?.startDate);
    const endDate = toDate(data.dates?.endDate);
    if (!startDate || !endDate) {
      console.warn("[onContractCreated] Missing contract dates", {
        tenantId,
        contractId,
      });
      return;
    }

    if (endDate < startDate) {
      console.warn("[onContractCreated] Invalid date range", {
        tenantId,
        contractId,
      });
      return;
    }

    const dueDay = Number.isFinite(data.dueDay) ? Math.max(data.dueDay ?? 1, 1) : 1;
    const rentAmount = Number.isFinite(data.rentAmount) ? (data.rentAmount ?? 0) : 0;
    const periods = getMonthPeriods(startDate, endDate);
    const installmentsRef = db.collection("tenants").doc(tenantId).collection("installments");

    let createdCount = 0;
    let skippedCount = 0;

    for (const periodInfo of periods) {
      const { year, month, period } = periodInfo;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const safeDay = Math.min(dueDay, lastDay);
      const dueDate = new Date(year, month, safeDay);
      const status = getStatusForDueDate(dueDate);
      const totals = {
        total: rentAmount,
        paid: 0,
        due: rentAmount,
      };
      const installmentId = `${contractId}__${period}`;
      const installmentRef = installmentsRef.doc(installmentId);

      const existing = await installmentRef.get();
      if (existing.exists) {
        skippedCount += 1;
        continue;
      }

      await installmentRef.set({
        contractId,
        period,
        dueDate: Timestamp.fromDate(dueDate),
        status,
        totals,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      createdCount += 1;
    }

    console.log("[onContractCreated] Installments processed", {
      tenantId,
      contractId,
      createdCount,
      skippedCount,
    });
  });
