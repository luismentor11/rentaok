"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/lib/firebase";
import { recordDebugError } from "@/lib/debug";

type ServicesTabProps = {
  contractId: string;
  role: string;
};

const serviceOptions = [
  { key: "agua", label: "Agua" },
  { key: "luz", label: "Luz" },
  { key: "gas", label: "Gas" },
  { key: "imp_municipal", label: "Imp. municipal" },
  { key: "imp_provincial", label: "Imp. provincial" },
  { key: "rentas", label: "Rentas" },
  { key: "expensas", label: "Expensas" },
  { key: "otros", label: "Otros" },
] as const;

const serviceKeyOrder = serviceOptions.map((option) => option.key);

const normalizeServiceKeys = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

const orderServiceKeys = (keys: string[]) => {
  const selected = new Set(keys);
  return serviceKeyOrder.filter((key) => selected.has(key));
};

export default function ServicesTab({ contractId, role }: ServicesTabProps) {
  const { user, loading: authLoading } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const canEdit = ["tenant_owner", "manager", "operator"].includes(role);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setTenantError("Necesitas iniciar sesion para ver servicios.");
      setTenantId(null);
      setTenantLoading(false);
      return;
    }
    let active = true;
    setTenantLoading(true);
    setTenantError(null);
    user
      .getIdTokenResult()
      .then((tokenResult) => {
        if (!active) return;
        const nextTenantId =
          typeof tokenResult.claims?.tenantId === "string"
            ? tokenResult.claims.tenantId
            : null;
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          setTenantError("No encontramos un tenant activo.");
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error("ServicesTab:tenant", err);
        recordDebugError("services:tenant", err);
        setTenantError("No pudimos cargar el tenant.");
        setTenantId(null);
      })
      .finally(() => {
        if (!active) return;
        setTenantLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, user]);

  useEffect(() => {
    if (!contractId || tenantLoading) return;
    if (!tenantId) {
      setSelectedKeys([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorText(null);

    const contractRef = doc(db, "tenants", tenantId, "contracts", contractId);
    const unsubscribe = onSnapshot(
      contractRef,
      (snap) => {
        if (!snap.exists()) {
          setErrorText("Contrato no encontrado.");
          setSelectedKeys([]);
          setLoading(false);
          return;
        }
        const data = snap.data() as { serviceKeys?: unknown };
        const nextKeys = orderServiceKeys(normalizeServiceKeys(data?.serviceKeys));
        setSelectedKeys(nextKeys);
        setLoading(false);
      },
      (err) => {
        console.error("ServicesTab:contract", err);
        recordDebugError("services:contract", err);
        setErrorText("No pudimos cargar servicios.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [contractId, tenantId, tenantLoading]);

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return orderServiceKeys(Array.from(next));
    });
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-zinc-900">
        Servicios del contrato
      </div>
      {tenantError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {tenantError}
        </div>
      )}
      {errorText && (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          {errorText}
        </div>
      )}
      {tenantLoading || loading ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          Cargando...
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {serviceOptions.map((option) => {
              const checked = selectedKeys.includes(option.key);
              return (
                <label
                  key={option.key}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleKey(option.key)}
                    disabled={saving || !canEdit}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center justify-end">
            <button
              type="button"
              disabled={saving || !canEdit}
              onClick={async () => {
                if (!tenantId || !contractId || !canEdit) return;
                setSaving(true);
                setErrorText(null);
                try {
                  await updateDoc(
                    doc(db, "tenants", tenantId, "contracts", contractId),
                    { serviceKeys: selectedKeys }
                  );
                } catch (err) {
                  console.error("ServicesTab:save", err);
                  recordDebugError("services:save", err);
                  setErrorText("No pudimos guardar servicios.");
                } finally {
                  setSaving(false);
                }
              }}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
