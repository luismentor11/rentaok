"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toDateSafe } from "@/lib/utils/firestoreDate";
type ServiceRecord = {
  id: string;
  tenantId: string;
  contractId: string;
  type: string;
  frequency: string;
  period: string;
  dueDate: unknown;
  amount?: number;
  status: string;
  receiptUrl?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type ServicesTabProps = {
  contractId: string;
  role: string;
};

const getCurrentPeriodValue = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const getServiceStatusTone = (status: string) => {
  const normalized = status.trim().toUpperCase();
  if (normalized.includes("PAG")) {
    return "bg-emerald-100 text-emerald-700";
  }
  if (normalized.includes("VENC")) {
    return "bg-red-100 text-red-700";
  }
  if (normalized.includes("PEND") || normalized.includes("POR")) {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-zinc-100 text-zinc-700";
};

const formatServiceDueDate = (value: ServiceRecord["dueDate"]) => {
  const date = toDateSafe(value);
  return date ? date.toLocaleDateString() : "-";
};

export default function ServicesTab({ contractId, role }: ServicesTabProps) {
  const [period, setPeriod] = useState(getCurrentPeriodValue());
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contractId || !period) return;
    setLoading(true);
    setError(null);

    const servicesRef = collection(db, "services");
    const q = query(
      servicesRef,
      where("contractId", "==", contractId),
      where("period", "==", period),
      orderBy("dueDate", "asc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<ServiceRecord, "id">),
        }));
        setServices(next);
        setLoading(false);
      },
      (err) => {
        setError(err?.message ?? "No se pudieron cargar servicios.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [contractId, period]);

  const isOwner = role === "owner";
  const canEdit = ["tenant_owner", "manager", "operator"].includes(role);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-600">
          Servicios del periodo seleccionado.
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {isOwner && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-700">
              Solo lectura
            </span>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-zinc-500">Periodo</label>
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-none"
            />
          </div>
        </div>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading ? (
        <div className="text-sm text-zinc-600">Cargando servicios...</div>
      ) : services.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-6 text-sm text-zinc-600">
          No hay servicios para este periodo.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="min-w-full text-sm text-zinc-700">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Servicio</th>
                <th className="px-3 py-2 text-left font-medium">Vencimiento</th>
                <th className="px-3 py-2 text-left font-medium">Importe</th>
                <th className="px-3 py-2 text-left font-medium">Estado</th>
                <th className="px-3 py-2 text-left font-medium">Accion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {services.map((service) => {
                const amountValue = Number(service.amount);
                const amountDisplay = Number.isFinite(amountValue)
                  ? amountValue.toLocaleString("es-AR")
                  : "—";
                const statusLabel = service.status || "Sin estado";
                return (
                  <tr key={service.id} className="bg-white">
                    <td className="px-3 py-2 font-medium text-zinc-900">
                      {service.type}
                    </td>
                    <td className="px-3 py-2">
                      {formatServiceDueDate(service.dueDate)}
                    </td>
                    <td className="px-3 py-2">{amountDisplay}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${getServiceStatusTone(
                          statusLabel
                        )}`}
                      >
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {canEdit && (
                          <button
                            type="button"
                            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                          >
                            Editar
                          </button>
                        )}
                        {service.receiptUrl && (
                          <Link
                            href={service.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                          >
                            Descargar
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
