"use client";

import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Installment } from "@/lib/db/installments";
import type { Contract } from "@/lib/model/v1";

export type NotificationDueType = "PRE_DUE_5" | "POST_DUE_1";

const resolveTenantRecipients = (contract: Contract) => {
  const email = contract.parties.tenant.email?.trim();
  const whatsapp = contract.parties.tenant.whatsapp?.trim();
  return {
    emailRecipients: email ? [email] : [],
    whatsappRecipients: whatsapp ? [whatsapp] : [],
  };
};

const toDateNumber = (date: Date) =>
  date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();

const getDueDateFromInstallment = (installment: Installment) => {
  const maybeDate = (installment.dueDate as any)?.toDate?.();
  if (maybeDate instanceof Date) return maybeDate;
  return installment.dueDate instanceof Date ? installment.dueDate : null;
};

const formatDateDdMmYyyy = (date: Date) =>
  `${String(date.getDate()).padStart(2, "0")}/${String(
    date.getMonth() + 1
  ).padStart(2, "0")}/${date.getFullYear()}`;

export function getNotificationDueToday(
  installment: Installment,
  todayDate: Date
): NotificationDueType | null {
  const dueDate = getDueDateFromInstallment(installment);
  if (!dueDate) return null;

  const todayNumber = toDateNumber(todayDate);
  const preDate = new Date(dueDate);
  preDate.setDate(preDate.getDate() - 5);
  if (toDateNumber(preDate) === todayNumber) {
    return "PRE_DUE_5";
  }

  const postDate = new Date(dueDate);
  postDate.setDate(postDate.getDate() + 1);
  if (
    toDateNumber(postDate) === todayNumber &&
    installment.status !== "PAGADA"
  ) {
    return "POST_DUE_1";
  }

  return null;
}

export function getGuarantorEscalationDueToday(
  installment: Installment,
  todayDate: Date
) {
  const dueDate = getDueDateFromInstallment(installment);
  if (!dueDate) return false;

  const todayNumber = toDateNumber(todayDate);
  const escalationDate = new Date(dueDate);
  escalationDate.setDate(escalationDate.getDate() + 5);
  return toDateNumber(escalationDate) === todayNumber;
}

export function buildTenantNotificationMessage(params: {
  installment: Installment;
  contractId?: string;
  dueType: NotificationDueType;
}) {
  const { installment, contractId, dueType } = params;
  const dueDate = getDueDateFromInstallment(installment);
  const dueDateLabel = dueDate ? formatDateDdMmYyyy(dueDate) : "-";
  const dueAmount = Number(installment.totals?.due ?? 0);
  const reminderLabel =
    dueType === "PRE_DUE_5"
      ? "Recordatorio 5 dias antes"
      : "Recordatorio 1 dia despues";
  const subject = `${reminderLabel} - Periodo ${installment.period}`;
  const lines = [
    reminderLabel,
    `Periodo: ${installment.period}`,
    `Vencimiento: ${dueDateLabel}`,
    `Estado: ${installment.status}`,
    `Monto adeudado: ${dueAmount}`,
  ];

  if (contractId) {
    lines.push(`Contrato: ${contractId}`);
  }

  const body = lines.join("\n");
  return {
    subject,
    body,
    whatsappText: body,
  };
}

export function buildGuarantorNotificationMessage(params: {
  installment: Installment;
  contractId?: string;
}) {
  const { installment, contractId } = params;
  const dueDate = getDueDateFromInstallment(installment);
  const dueDateLabel = dueDate ? formatDateDdMmYyyy(dueDate) : "-";
  const subject = `Aviso a garante - Periodo ${installment.period}`;
  const lines = [
    `Periodo: ${installment.period}`,
    `Vencimiento: ${dueDateLabel}`,
    `Estado: ${installment.status}`,
    "Se aplicara mora segun contrato si no se regulariza.",
  ];

  if (contractId) {
    lines.push(`Contrato: ${contractId}`);
  }

  const body = lines.join("\n");
  return {
    subject,
    body,
    whatsappText: body,
  };
}

export async function updateContractNotificationConfig(
  tenantId: string,
  contractId: string,
  enabled: boolean
) {
  const contractRef = doc(db, "tenants", tenantId, "contracts", contractId);
  const snap = await getDoc(contractRef);
  if (!snap.exists()) {
    throw new Error("Contrato no encontrado.");
  }

  const contract = snap.data() as Contract;
  const recipients = resolveTenantRecipients(contract);

  await updateDoc(contractRef, {
    notificationConfig: {
      enabled,
      ...recipients,
    },
    updatedAt: serverTimestamp(),
  });
}

export async function setInstallmentNotificationOverride(
  tenantId: string,
  installmentId: string,
  enabled: boolean | null
) {
  const installmentRef = doc(
    db,
    "tenants",
    tenantId,
    "installments",
    installmentId
  );

  if (enabled === null) {
    await updateDoc(installmentRef, {
      notificationOverride: deleteField(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  await updateDoc(installmentRef, {
    notificationOverride: { enabled },
    updatedAt: serverTimestamp(),
  });
}
