"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
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

const statusOptions = [
  { value: "pending", label: "Pendiente" },
  { value: "recorded", label: "Registrado" },
  { value: "paid", label: "Pagado" },
  { value: "overdue", label: "Vencido" },
] as const;

export default function ServicesTab({ contractId, role }: ServicesTabProps) {
  const [period, setPeriod] = useState(getCurrentPeriodValue());
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<ServiceRecord | null>(
    null
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [statusInput, setStatusInput] = useState("pending");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
  const trimmedAmount = amountInput.trim();
  const amountValue = trimmedAmount === "" ? null : Number(trimmedAmount);
  const isAmountValid =
    trimmedAmount === "" ||
    (amountValue !== null &&
      Number.isFinite(amountValue) &&
      amountValue >= 0);
  const isPaid = statusInput === "paid";

  const openEditModal = (service: ServiceRecord) => {
    setEditingService(service);
    setAmountInput(typeof service.amount === "number" ? String(service.amount) : "");
    setStatusInput(service.status || "pending");
    setReceiptFile(null);
    setModalError(null);
    setToastMessage(null);
    setModalOpen(true);
  };

  const closeEditModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingService(null);
  };

  const uploadReceipt = async (serviceId: string, file: File) => {
    const safeName = `${Date.now()}-${file.name}`;
    const storageRef = ref(storage, `services/${serviceId}/receipt/${safeName}`);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return getDownloadURL(storageRef);
  };

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
          Ocurrio un error. Intenta de nuevo.
        </div>
      )}
      {toastMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {toastMessage}
        </div>
      )}
      {loading ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          Cargando...
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          No hay servicios para este periodo.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-surface">
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
                  : "-";
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
                            onClick={() => openEditModal(service)}
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
      {modalOpen && editingService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-surface p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                Editar servicio
              </h3>
              <button
                type="button"
                onClick={closeEditModal}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                Cerrar
              </button>
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {editingService.type} - Vence {" "}
              {formatServiceDueDate(editingService.dueDate)}
            </div>
            {modalError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {modalError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Importe
                </label>
                <input
                  type="number"
                  value={amountInput}
                  onChange={(event) => setAmountInput(event.target.value)}
                  disabled={isPaid}
                  title={isPaid ? "Servicio pagado" : undefined}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  placeholder="1000"
                />
                {!isAmountValid && (
                  <div className="mt-1 text-xs text-red-600">
                    Importe invalido
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Estado
                </label>
                <select
                  value={statusInput}
                  onChange={(event) => setStatusInput(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700">
                  Comprobante
                </label>
                {editingService.receiptUrl && (
                  <div className="mt-2 text-xs">
                    <Link
                      href={editingService.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-zinc-700 underline hover:text-zinc-900"
                    >
                      Descargar
                    </Link>
                  </div>
                )}
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(event) =>
                    setReceiptFile(event.target.files?.[0] ?? null)
                  }
                  className="mt-2 w-full text-sm text-zinc-900 file:mr-3 file:rounded-md file:border file:border-zinc-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={saving}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving || !isAmountValid}
                onClick={async () => {
                  if (!editingService) return;
                  if (!isAmountValid) return;
                  setSaving(true);
                  setModalError(null);
                  try {
                    let receiptUrl: string | undefined;
                    if (receiptFile) {
                      receiptUrl = await uploadReceipt(
                        editingService.id,
                        receiptFile
                      );
                    }
                    const payload: Record<string, unknown> = {
                      status: statusInput,
                      updatedAt: serverTimestamp(),
                    };
                    if (amountValue !== null) {
                      payload.amount = amountValue;
                    } else {
                      payload.amount = deleteField();
                    }
                    if (receiptUrl) {
                      payload.receiptUrl = receiptUrl;
                    }
                    await updateDoc(
                      doc(db, "services", editingService.id),
                      payload
                    );
                    setModalOpen(false);
                    setEditingService(null);
                    setToastMessage("Servicio actualizado");
                    setTimeout(() => setToastMessage(null), 2500);
                  } catch (err: any) {
                    setModalError("No se pudo guardar");
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
        </div>
      )}
    </div>
  );
}
