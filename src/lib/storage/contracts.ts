"use client";

import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";
import type { ContractPdfMetadata } from "@/lib/model/v1";

export async function uploadContractPdf(
  tenantId: string,
  contractId: string,
  file: File
): Promise<ContractPdfMetadata> {
  const path = `tenants/${tenantId}/contracts/${contractId}/contract.pdf`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, {
    contentType: file.type || "application/pdf",
  });
  const downloadUrl = await getDownloadURL(storageRef);
  return {
    path,
    downloadUrl,
    uploadedAt: new Date().toISOString(),
  };
}
