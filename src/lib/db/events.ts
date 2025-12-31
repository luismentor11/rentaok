"use client";

import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

export type ContractEventType =
  | "MENSAJE"
  | "LLAMADA"
  | "RECLAMO"
  | "DAÑO"
  | "ACUERDO"
  | "OTRO";

export type ContractEventAttachment = {
  name: string;
  path: string;
  url: string;
};

export type ContractEvent = {
  type: ContractEventType;
  at: Timestamp;
  detail: string;
  tags?: string[];
  installmentId?: string;
  attachments?: ContractEventAttachment[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type EventRecord = ContractEvent & { id: string };

const toSafeFilename = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, "_");

const stripUndefinedDeep = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype) {
      return value;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefinedDeep(item)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
};

const sanitizePayload = <T extends Record<string, unknown>>(value: T) =>
  stripUndefinedDeep(value) as T;

export async function listContractEvents(tenantId: string, contractId: string) {
  const ref = collection(db, "tenants", tenantId, "contracts", contractId, "events");
  const q = query(ref, orderBy("at", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<ContractEvent, "id">),
  })) as EventRecord[];
}

export async function addContractEvent(
  tenantId: string,
  contractId: string,
  input: {
    type: ContractEventType;
    at?: Date | string;
    detail: string;
    tags?: string[];
    installmentId?: string;
    createdBy: string;
  }
) {
  if (!input.type) {
    throw new Error("El tipo de evento es obligatorio.");
  }
  const detailValue = input.detail?.trim();
  if (!detailValue) {
    throw new Error("El detalle es obligatorio.");
  }
  if (!input.createdBy) {
    throw new Error("El creador es obligatorio.");
  }
  const atDate =
    input.at instanceof Date
      ? input.at
      : input.at
        ? new Date(input.at)
        : new Date();
  if (!Number.isFinite(atDate.getTime())) {
    throw new Error("La fecha del evento es invalida.");
  }

  const ref = collection(db, "tenants", tenantId, "contracts", contractId, "events");
  const payload = sanitizePayload({
    type: input.type,
    at: Timestamp.fromDate(atDate),
    detail: detailValue,
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(input.installmentId ? { installmentId: input.installmentId } : {}),
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const docRef = await addDoc(ref, payload);
  return docRef.id;
}

export async function uploadEventAttachment(
  tenantId: string,
  contractId: string,
  eventId: string,
  file: File
): Promise<ContractEventAttachment> {
  const safeName = toSafeFilename(file.name || "adjunto");
  const timestamp = Date.now();
  const path = `tenants/${tenantId}/contracts/${contractId}/events/${eventId}/attachments/${timestamp}_${safeName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, {
    contentType: file.type || "application/octet-stream",
  });
  const url = await getDownloadURL(storageRef);
  return { name: file.name, path, url };
}

export async function updateContractEventAttachments(
  tenantId: string,
  contractId: string,
  eventId: string,
  attachments: ContractEventAttachment[]
) {
  const ref = doc(db, "tenants", tenantId, "contracts", contractId, "events", eventId);
  const payload = sanitizePayload({
    attachments,
    updatedAt: serverTimestamp(),
  });
  await updateDoc(ref, payload);
}
