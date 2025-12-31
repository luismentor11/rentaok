"use client";

import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Contract } from "@/lib/model/v1";

const resolveTenantRecipients = (contract: Contract) => {
  const email = contract.parties.tenant.email?.trim();
  const whatsapp = contract.parties.tenant.whatsapp?.trim();
  return {
    emailRecipients: email ? [email] : [],
    whatsappRecipients: whatsapp ? [whatsapp] : [],
  };
};

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
