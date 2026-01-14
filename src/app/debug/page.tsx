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
import { readAiError, readDebugError, type DebugErrorEntry } from "@/lib/debug";

type TestState = {
  status: "idle" | "running" | "ok" | "error";
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
  const [lastError, setLastError] = useState<DebugErrorEntry | null>(null);
  const [lastAiError, setLastAiError] = useState<DebugErrorEntry | null>(null);
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

  useEffect(() => {
    setLastError(readDebugError());
    setLastAiError(readAiError());
  }, []);

  const runTest = async (
    key: keyof typeof tests,
    runner: () => Promise<number>
  ) => {
    setTests((prev) => ({
      ...prev,
      [key]: { status: "running", message: "EJECUTANDO..." },
    }));
    try {
      const count = await runner();
      setTests((prev) => ({
        ...prev,
        [key]: { status: "ok", message: `OK (count=${count})` },
      }));
    } catch (err) {
      console.error(`[DEBUG TEST ${String(key)}]`, err);
      const errorObj = err as { code?: string; message?: string };
      const errorCode = errorObj?.code ? String(errorObj.code) : "unknown";
      const errorMessage = errorObj?.message
        ? String(errorObj.message)
        : getErrorText(err);
      setTests((prev) => ({
        ...prev,
        [key]: {
          status: "error",
          message: `ERROR: ${errorCode} ${errorMessage}`,
        },
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

      <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2 text-sm text-zinc-700">
        <div className="text-sm font-semibold text-zinc-900">Notas</div>
        <div>Rules: revisar `firestore.rules` desplegadas.</div>
        <div>Indexes: revisar `firestore.indexes.json` en el repo.</div>
        <div>Consultas criticas: evitar indices compuestos.</div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2 text-sm text-zinc-700">
        <div className="text-sm font-semibold text-zinc-900">Ultimo error</div>
        {lastError ? (
          <div className="space-y-1 text-xs text-zinc-600">
            <div>
              <span className="font-medium text-zinc-900">Scope:</span>{" "}
              {lastError.scope}
            </div>
            <div>
              <span className="font-medium text-zinc-900">At:</span>{" "}
              {lastError.at}
            </div>
            <div>
              <span className="font-medium text-zinc-900">Message:</span>{" "}
              {lastError.message}
            </div>
            {lastError.code && (
              <div>
                <span className="font-medium text-zinc-900">Code:</span>{" "}
                {lastError.code}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-zinc-600">Sin errores recientes.</div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-2 text-sm text-zinc-700">
        <div className="text-sm font-semibold text-zinc-900">
          Ultimo error IA
        </div>
        {lastAiError ? (
          <div className="space-y-1 text-xs text-zinc-600">
            <div>
              <span className="font-medium text-zinc-900">Scope:</span>{" "}
              {lastAiError.scope}
            </div>
            <div>
              <span className="font-medium text-zinc-900">At:</span>{" "}
              {lastAiError.at}
            </div>
            <div>
              <span className="font-medium text-zinc-900">Message:</span>{" "}
              {lastAiError.message}
            </div>
            {lastAiError.code && (
              <div>
                <span className="font-medium text-zinc-900">Code:</span>{" "}
                {lastAiError.code}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-zinc-600">Sin errores recientes.</div>
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
                const snap = await getDocs(
                  query(collection(db, "tenants", tenant, "contracts"), limit(1))
                );
                return snap.size;
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
                const snap = await getDocs(
                  query(collection(db, "tenants", tenant, "installments"), limit(1))
                );
                return snap.size;
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
                const snap = await getDocs(
                  query(collection(db, "tenants", tenant, "services"), limit(1))
                );
                return snap.size;
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
            {tests.contracts.message || "-"}
          </div>
          <div>
            Installments:{" "}
            {tests.installments.message || "-"}
          </div>
          <div>
            Services:{" "}
            {tests.services.message || "-"}
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
              return 1;
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
