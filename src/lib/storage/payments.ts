"use client";

import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";
import type { PaymentReceipt } from "@/lib/db/installments";

const toSafeFilename = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, "_");

export async function uploadPaymentReceipt(
  tenantId: string,
  paymentId: string,
  file: File
): Promise<PaymentReceipt> {
  const safeName = toSafeFilename(file.name || "comprobante");
  const timestamp = Date.now();
  const path = `tenants/${tenantId}/receipts/${paymentId}_${timestamp}_${safeName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, {
    contentType: file.type || "application/octet-stream",
  });
  const url = await getDownloadURL(storageRef);
  return { name: file.name, path, url };
}
