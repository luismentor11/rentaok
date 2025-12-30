"use client";

import { collection, doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import { ensureUserProfile } from "@/lib/db/users";

export type Tenant = {
  name: string;
  ownerUid: string;
  createdAt: unknown;
  updatedAt: unknown;
};

export async function createTenantForUser(user: User, name: string) {
  await ensureUserProfile(user);

  const ref = doc(collection(db, "tenants"));
  const tenant: Tenant = {
    name,
    ownerUid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(ref, tenant);
  await updateDoc(doc(db, "users", user.uid), {
    tenantId: ref.id,
    role: "owner",
    updatedAt: serverTimestamp(),
  });

  return { id: ref.id, ...tenant };
}

export async function getTenant(tenantId: string) {
  const ref = doc(db, "tenants", tenantId);
  const snap = await getDoc(ref);
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as Tenant) }) : null;
}
