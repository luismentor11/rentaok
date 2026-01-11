import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

type InstallmentStatus = "POR_VENCER" | "VENCE_HOY" | "VENCIDA" | "PAGADA";

type InstallmentRecord = {
  status?: InstallmentStatus;
  dueDate?: FirebaseFirestore.Timestamp | Date;
};

const db = getFirestore();

const toDateNumberUtc = (date: Date) =>
  date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();

const getStatusForDueDateUtc = (dueDate: Date) => {
  const todayNumber = toDateNumberUtc(new Date());
  const dueNumber = toDateNumberUtc(dueDate);
  if (dueNumber > todayNumber) return "POR_VENCER";
  if (dueNumber === todayNumber) return "VENCE_HOY";
  return "VENCIDA";
};

const toDateSafe = (value: InstallmentRecord["dueDate"]) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  return value.toDate?.() ?? null;
};

export const recomputeInstallmentStatusDaily = onSchedule(
  { schedule: "every day 02:30", timeZone: "UTC" },
  async () => {
    const targetStatuses: InstallmentStatus[] = [
      "POR_VENCER",
      "VENCE_HOY",
      "VENCIDA",
    ];
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let updatedCount = 0;
    let scannedCount = 0;

    while (true) {
      let query = db
        .collectionGroup("installments")
        .where("status", "in", targetStatuses)
        .orderBy(FieldPath.documentId())
        .limit(500);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snap = await query.get();
      if (snap.empty) break;

      const batch = db.batch();
      let batchUpdates = 0;

      for (const docSnap of snap.docs) {
        scannedCount += 1;
        const data = docSnap.data() as InstallmentRecord;
        const dueDate = toDateSafe(data.dueDate);
        if (!dueDate) continue;

        const currentStatus = data.status ?? "POR_VENCER";
        const nextStatus = getStatusForDueDateUtc(dueDate);
        if (nextStatus !== currentStatus) {
          batch.update(docSnap.ref, {
            status: nextStatus,
            updatedAt: FieldValue.serverTimestamp(),
          });
          batchUpdates += 1;
          updatedCount += 1;
        }
      }

      if (batchUpdates > 0) {
        await batch.commit();
      }

      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < 500) break;
    }

    console.log("[recomputeInstallmentStatusDaily] Done", {
      scannedCount,
      updatedCount,
      timeZone: "UTC",
    });
  }
);
