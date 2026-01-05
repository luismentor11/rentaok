import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();

type ServiceType = "expensas" | "luz" | "gas" | "agua" | "abl" | "otro";
type ServiceFrequency = "monthly" | "bimonthly" | "quarterly" | "eventual";

type ServiceConfig = {
  type: ServiceType;
  frequency: ServiceFrequency;
  dueDay?: number;
};

type ContractDates = {
  startDate?: string;
  endDate?: string;
};

type ContractData = {
  dates?: ContractDates;
  dueDay?: number;
  services?: ServiceConfig[];
};

const SERVICE_TYPES: ServiceType[] = [
  "expensas",
  "luz",
  "gas",
  "agua",
  "abl",
  "otro",
];

const SERVICE_FREQUENCIES: ServiceFrequency[] = [
  "monthly",
  "bimonthly",
  "quarterly",
  "eventual",
];

const db = getFirestore();

function toDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthsBetween(start: Date, end: Date) {
  return end.getFullYear() * 12 + end.getMonth() - (start.getFullYear() * 12 + start.getMonth());
}

function shouldGenerate(
  frequency: ServiceFrequency,
  anchorDate: Date,
  currentMonth: Date
) {
  if (frequency === "eventual") return false;
  if (frequency === "monthly") return true;
  const diff = monthsBetween(anchorDate, currentMonth);
  if (frequency === "bimonthly") return diff % 2 === 0;
  if (frequency === "quarterly") return diff % 3 === 0;
  return false;
}

function getPeriodKey(currentMonth: Date) {
  const month = String(currentMonth.getMonth() + 1).padStart(2, "0");
  return `${currentMonth.getFullYear()}-${month}`;
}

function clampDueDate(year: number, month: number, day: number) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.min(Math.max(day, 1), lastDay);
  return new Date(year, month, safeDay);
}

function safeIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export const generateMonthlyServices = onSchedule("every day 02:00", async () => {
  const now = new Date();
  const periodDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodKey = getPeriodKey(periodDate);

  const contractsSnap = await db.collectionGroup("contracts").get();
  const writes: Promise<unknown>[] = [];

  contractsSnap.forEach((docSnap) => {
    const data = docSnap.data() as ContractData;
    const pathParts = docSnap.ref.path.split("/");
    if (pathParts.length !== 4) return;
    if (pathParts[0] !== "tenants" || pathParts[2] !== "contracts") return;
    const tenantId = pathParts[1];
    if (!tenantId) return;

    const startDate = toDate(data?.dates?.startDate);
    const endDate = toDate(data?.dates?.endDate);
    if (!startDate || !endDate) return;
    if (now < startDate || now > endDate) return;

    const dueDay = data?.dueDay ?? 1;
    const configs = Array.isArray(data?.services) ? data.services : [];
    for (const config of configs) {
      if (!SERVICE_TYPES.includes(config.type)) continue;
      if (!SERVICE_FREQUENCIES.includes(config.frequency)) continue;
      if (!shouldGenerate(config.frequency, startDate, periodDate)) continue;

      const dueDate = clampDueDate(
        periodDate.getFullYear(),
        periodDate.getMonth(),
        config.dueDay ?? dueDay
      );

      const serviceId = [
        safeIdPart(tenantId),
        safeIdPart(docSnap.id),
        config.type,
        periodKey,
      ].join("_");
      const serviceRef = db.collection("services").doc(serviceId);
      const payload = {
        tenantId,
        contractId: docSnap.id,
        type: config.type,
        frequency: config.frequency,
        period: periodKey,
        dueDate: Timestamp.fromDate(dueDate),
        status: "pending",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      writes.push(
        serviceRef.create(payload).catch((err) => {
          if (err?.code === 6 || err?.message?.includes("ALREADY_EXISTS")) {
            return null;
          }
          throw err;
        })
      );
    }
  });

  if (writes.length) {
    await Promise.all(writes);
  }
});
