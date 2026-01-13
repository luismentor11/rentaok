"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type TestState = {
  status: "idle" | "ok" | "error";
  message: string;
};

const emptyTest: TestState = { status: "idle", message: "" };

const getErrorText = (err: unknown) =>
  err && typeof err === "object"
    ? (err as { stack?: string; message?: string }).stack ||
      (err as { message?: string }).message ||
      JSON.stringify(err)
    : String(err);

export default function DebugPage() {
  const { user, loading } = useAuth();
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [profileTenantId, setProfileTenantId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [tests, setTests] = useState<{
    contracts: TestState;
    installments: TestState;
    services: TestState;
    sync: TestState;
  }>({
    contracts: emptyTest,
    installments: emptyTest,
    services: emptyTest,
    sync: emptyTest,
  });

  useEffect(() => {
    if (!user) {
      setActiveTenantId(null);
      setProfileTenantId(null);
      return;
    }
    let active = true;
    const resolveTenant = async () => {
      setResolveError(null);
      try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        if (!active) return;
        const nextProfileTenantId =
          typeof snap.data()?.tenantId === "string" ? snap.data()?.tenantId : null;
        setProfileTenantId(nextProfileTenantId);
        if (nextProfileTenantId) {
          setActiveTenantId(nextProfileTenantId);
          return;
        }
        const contractsSnap = await getDocs(
          query(
            collectionGroup(db, "contracts"),
            where("createdByUid", "==", user.uid),
            limit(1)
          )
        );
        if (!active) return;
        if (!contractsSnap.empty) {
          const path = contractsSnap.docs[0].ref.path;
          const match = path.match(/^tenants\/([^/]+)\/contracts\//);
          setActiveTenantId(match?.[1] ?? null);
        } else {
          setActiveTenantId(null);
        }
      } catch (err) {
        if (!active) return;
        setResolveError(getErrorText(err));
      }
    };

    resolveTenant();
    return () => {
      active = false;
    };
  }, [user]);

  const runTest = async (
    key: keyof typeof tests,
    runner: () => Promise<void>
  ) => {
    setTests((prev) => ({
      ...prev,
      [key]: { status: "idle", message: "Ejecutando..." },
    }));
    try {
      await runner();
      setTests((prev) => ({
        ...prev,
        [key]: { status: "ok", message: "OK" },
      }));
    } catch (err) {
      setTests((prev) => ({
        ...prev,
        [key]: { status: "error", message: getErrorText(err) },
      }));
    }
  };

  const ensureTenantId = () => {
    if (!activeTenantId) {
      throw new Error("TenantId activo no disponible.");
    }
    return activeTenantId;
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
        Cargando...
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Debug</h1>
        <p className="text-sm text-zinc-600">
          Diagnostico rapido de auth, tenant y permisos.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2 text-sm text-zinc-700">
        <div>
          <span className="font-medium text-zinc-900">UID:</span>{" "}
          {user?.uid ?? "-"}
        </div>
        <div>
          <span className="font-medium text-zinc-900">Email:</span>{" "}
          {user?.email ?? "-"}
        </div>
        <div>
          <span className="font-medium text-zinc-900">Tenant activo:</span>{" "}
          {activeTenantId ?? "-"}
        </div>
        <div>
          <span className="font-medium text-zinc-900">
            users/{user?.uid ?? "uid"}.tenantId:
          </span>{" "}
          {profileTenantId ?? "-"}
        </div>
        {resolveError && (
          <div className="text-xs text-red-600">Error: {resolveError}</div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-zinc-900">Tests</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              runTest("contracts", async () => {
                const tenant = ensureTenantId();
                await getDocs(
                  query(collection(db, "tenants", tenant, "contracts"), limit(1))
                );
              })
            }
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Test contratos
          </button>
          <button
            type="button"
            onClick={() =>
              runTest("installments", async () => {
                const tenant = ensureTenantId();
                await getDocs(
                  query(collection(db, "tenants", tenant, "installments"), limit(1))
                );
              })
            }
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Test installments
          </button>
          <button
            type="button"
            onClick={() =>
              runTest("services", async () => {
                const tenant = ensureTenantId();
                await getDocs(
                  query(collection(db, "tenants", tenant, "services"), limit(1))
                );
              })
            }
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Test services
          </button>
        </div>
        <div className="grid gap-2 text-xs text-zinc-600">
          <div>
            Contratos:{" "}
            {tests.contracts.status === "error"
              ? `ERROR - ${tests.contracts.message}`
              : tests.contracts.message || "-"}
          </div>
          <div>
            Installments:{" "}
            {tests.installments.status === "error"
              ? `ERROR - ${tests.installments.message}`
              : tests.installments.message || "-"}
          </div>
          <div>
            Services:{" "}
            {tests.services.status === "error"
              ? `ERROR - ${tests.services.message}`
              : tests.services.message || "-"}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-zinc-900">Membership</div>
        <button
          type="button"
          onClick={() =>
            runTest("sync", async () => {
              if (!user) {
                throw new Error("Usuario no autenticado.");
              }
              const tenant = ensureTenantId();
              await setDoc(
                doc(db, "users", user.uid),
                { tenantId: tenant, updatedAt: serverTimestamp() },
                { merge: true }
              );
            })
          }
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Sync membership
        </button>
        <div className="text-xs text-zinc-600">
          {tests.sync.status === "error"
            ? `ERROR - ${tests.sync.message}`
            : tests.sync.message || "-"}
        </div>
      </div>

      <Link
        href="/contracts"
        className="inline-flex text-sm font-medium text-zinc-700 hover:text-zinc-900"
      >
        Ir a contratos
      </Link>
    </section>
  );
}
