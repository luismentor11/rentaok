"use client";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Contract } from "@/lib/model/v1";

export type ContractRecord = Contract & { id: string };

export async function listContracts(tenantId: string) {
  const ref = collection(db, "tenants", tenantId, "contracts");
  const snap = await getDocs(ref);
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<Contract, "id">),
  })) as ContractRecord[];
}

export async function listContractsPage(
  tenantId: string,
  opts?: { pageSize?: number; cursor?: any }
): Promise<{ items: ContractRecord[]; nextCursor: any | null }> {
  const ref = collection(db, "tenants", tenantId, "contracts");
  const pageSize = opts?.pageSize ?? 25;
  const baseQuery = query(ref, orderBy("createdAt", "desc"));
  const q = opts?.cursor
    ? query(baseQuery, startAfter(opts.cursor), limit(pageSize))
    : query(baseQuery, limit(pageSize));
  const snap = await getDocs(q);
  const items = snap.docs.map(
    (docSnap) =>
      ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Contract, "id">),
      }) as ContractRecord
  );
  const nextCursor = snap.docs.length
    ? snap.docs[snap.docs.length - 1]
    : null;
  return { items, nextCursor };
}

export async function createContract(tenantId: string, data: Contract) {
  await setDoc(
    doc(db, "tenants", tenantId),
    { updatedAt: serverTimestamp(), createdAt: serverTimestamp() },
    { merge: true }
  );
  const ref = collection(db, "tenants", tenantId, "contracts");
  const payload = {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const nextPropertyId = payload.property?.id ?? crypto.randomUUID();
  const sanitizedPayload = {
    ...payload,
    property: {
      ...payload.property,
      id: nextPropertyId,
    },
  };
  const docRef = await addDoc(ref, sanitizedPayload);
  return docRef.id;
}

export async function getContract(tenantId: string, contractId: string) {
  let normalizedId = contractId;
  try {
    normalizedId = decodeURIComponent(contractId);
  } catch {
    normalizedId = contractId;
  }
  const ref = doc(db, "tenants", tenantId, "contracts", normalizedId);
  const snap = await getDocFromServer(ref).catch(() => getDoc(ref));
  if (snap.exists()) {
    return {
      id: snap.id,
      ...(snap.data() as Omit<Contract, "id">),
    } as ContractRecord;
  }
  return null;
}

export async function updateContract(
  tenantId: string,
  contractId: string,
  data: Partial<Contract>
) {
  await setDoc(
    doc(db, "tenants", tenantId),
    { updatedAt: serverTimestamp(), createdAt: serverTimestamp() },
    { merge: true }
  );
  const ref = doc(db, "tenants", tenantId, "contracts", contractId);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}
