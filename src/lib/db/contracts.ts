"use client";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
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

export async function createContract(tenantId: string, data: Contract) {
  const ref = collection(db, "tenants", tenantId, "contracts");
  const payload = {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const docRef = await addDoc(ref, payload);
  return docRef.id;
}

export async function getContract(tenantId: string, contractId: string) {
  const ref = doc(db, "tenants", tenantId, "contracts", contractId);
  const snap = await getDoc(ref);
  return snap.exists()
    ? ({
        id: snap.id,
        ...(snap.data() as Omit<Contract, "id">),
      } as ContractRecord)
    : null;
}

export async function updateContract(
  tenantId: string,
  contractId: string,
  data: Partial<Contract>
) {
  const ref = doc(db, "tenants", tenantId, "contracts", contractId);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}
