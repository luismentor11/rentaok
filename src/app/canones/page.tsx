"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/lib/firebase";
import { toDateSafe } from "@/lib/utils/firestoreDate";
import type { ContractRecord } from "@/lib/db/contracts";
import {
  listInstallmentItems,
  registerInstallmentPayment,
  upsertInstallmentItem,
  type InstallmentItemRecord,
  type InstallmentRecord,
  type PaymentMethod,
} from "@/lib/db/installments";

type ContractMap = Record<string, ContractRecord>;

const statusOptions = [
  { value: "ALL", label: "Todos" },
  { value: "VENCIDA", label: "Vencida" },
  { value: "POR_VENCER", label: "Por vencer" },
  { value: "VENCE_HOY", label: "Vence hoy" },
  { value: "PARCIAL", label: "Parcial" },
  { value: "PAGADA", label: "Pagada" },
] as const;

const formatAmount = (value?: number) =>
  Number(value ?? 0).toLocaleString("es-AR");

const toDateTimeInputValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const buildMonthValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const getMonthRange = (monthValue: string) => {
  const [yearText, monthText] = monthValue.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0) {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
  }
  return {
    start: new Date(year, monthIndex, 1),
    end: new Date(year, monthIndex + 1, 1),
  };
};

const chunkIds = (ids: string[], size: number) => {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
};

export default function CanonesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [installments, setInstallments] = useState<InstallmentRecord[]>([]);
  const [installmentsLoading, setInstallmentsLoading] = useState(false);
  const [installmentsError, setInstallmentsError] = useState<string | null>(null);
  const [contractsById, setContractsById] = useState<ContractMap>({});
  const [selectedInstallmentId, setSelectedInstallmentId] = useState<string | null>(
    null
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [items, setItems] = useState<InstallmentItemRecord[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [payments, setPayments] = useState<
    {
      id: string;
      amount: number;
      paidAt: unknown;
      method?: PaymentMethod;
      note?: string;
    }[]
  >([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [itemLabel, setItemLabel] = useState("");
  const [itemAmount, setItemAmount] = useState("");
  const [itemSaving, setItemSaving] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("EFECTIVO");
  const [paymentPaidAt, setPaymentPaidAt] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<"items" | "payments">(
    "items"
  );

  const [statusFilter, setStatusFilter] = useState<
    (typeof statusOptions)[number]["value"]
  >("ALL");
  const [monthFilter, setMonthFilter] = useState(buildMonthValue(new Date()));
  const [searchTerm, setSearchTerm] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || loading) return;
    let active = true;
    const loadProfile = async () => {
      setPageLoading(true);
      setPageError(null);
      try {
        const tokenResult = await user.getIdTokenResult();
        if (!active) return;
        const nextTenantId =
          typeof tokenResult.claims?.tenantId === "string"
            ? tokenResult.claims.tenantId
            : null;
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          router.replace("/tenants");
        }
      } catch (err: any) {
        if (!active) return;
        setPageError(err?.message ?? "No se pudo cargar Canon/Mes.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [user, loading, router]);

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    const loadInstallments = async () => {
      setInstallmentsLoading(true);
      setInstallmentsError(null);
      try {
        const nextInstallments = await fetchInstallments(tenantId, monthFilter);
        if (!active) return;
        setInstallments(nextInstallments);
      } catch (err: any) {
        if (!active) return;
        setInstallmentsError(err?.message ?? "No se pudieron cargar periodos.");
        setInstallments([]);
      } finally {
        if (active) setInstallmentsLoading(false);
      }
    };

    loadInstallments();
    return () => {
      active = false;
    };
  }, [tenantId, monthFilter, statusFilter]);

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    const loadContracts = async () => {
      const contractIds = Array.from(
        new Set(installments.map((item) => item.contractId).filter(Boolean))
      ) as string[];
      if (contractIds.length === 0) {
        if (active) setContractsById({});
        return;
      }
      try {
        const chunks = chunkIds(contractIds, 10);
        const contractsRef = collection(
          db,
          "tenants",
          tenantId,
          "contracts"
        );
        const snapshots = await Promise.all(
          chunks.map((chunk) =>
            getDocs(query(contractsRef, where(documentId(), "in", chunk)))
          )
        );
        if (!active) return;
        const nextMap: ContractMap = {};
        snapshots.forEach((snap) => {
          snap.docs.forEach((docSnap) => {
            nextMap[docSnap.id] = {
              id: docSnap.id,
              ...(docSnap.data() as Omit<ContractRecord, "id">),
            };
          });
        });
        setContractsById(nextMap);
      } catch {
        if (active) setContractsById({});
      }
    };

    loadContracts();
    return () => {
      active = false;
    };
  }, [tenantId, installments]);

  const filteredInstallments = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const ownerSearch = ownerFilter.trim().toLowerCase();
    const baseList =
      statusFilter === "ALL"
        ? installments
        : installments.filter((installment) => installment.status === statusFilter);
    if (!search && !ownerSearch) return baseList;
    return baseList.filter((installment) => {
      const contract = installment.contractId
        ? contractsById[installment.contractId]
        : undefined;
      const propertyTitle = contract?.property?.title ?? "";
      const propertyAddress = contract?.property?.address ?? "";
      const ownerName = contract?.parties?.owner?.fullName ?? "";
      const tenantName = contract?.parties?.tenant?.fullName ?? "";
      const haystack = `${propertyTitle} ${propertyAddress} ${ownerName} ${tenantName}`
        .toLowerCase()
        .trim();
      const ownerMatch = ownerSearch
        ? ownerName.toLowerCase().includes(ownerSearch)
        : true;
      const textMatch = search ? haystack.includes(search) : true;
      return ownerMatch && textMatch;
    });
  }, [installments, contractsById, searchTerm, ownerFilter, statusFilter]);

  const selectedInstallment = useMemo(() => {
    if (!selectedInstallmentId) return null;
    return installments.find((item) => item.id === selectedInstallmentId) ?? null;
  }, [installments, selectedInstallmentId]);

  const openDrawer = (installmentId: string, focus?: "items" | "payments") => {
    setDrawerError(null);
    setSelectedInstallmentId(installmentId);
    setActiveSection(focus ?? "items");
    if (focus === "payments") {
      setPaymentPaidAt(toDateTimeInputValue(new Date()));
    }
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (itemSaving || paymentSaving) return;
    setDrawerOpen(false);
    setDrawerError(null);
    setItems([]);
    setPayments([]);
    setItemLabel("");
    setItemAmount("");
    setPaymentAmount("");
    setPaymentPaidAt("");
    setPaymentNote("");
  };

  const fetchInstallments = async (tenant: string, monthValue: string) => {
    const { start, end } = getMonthRange(monthValue);
    const constraints = [
      where("dueDate", ">=", Timestamp.fromDate(start)),
      where("dueDate", "<", Timestamp.fromDate(end)),
      orderBy("dueDate", "asc"),
      limit(400),
    ];
    const installmentsRef = collection(db, "tenants", tenant, "installments");
    const q = query(installmentsRef, ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<InstallmentRecord, "id">),
    }));
  };

  const loadDetails = async (installment: InstallmentRecord) => {
    if (!tenantId) return;
    setDrawerError(null);
    setItemsLoading(true);
    setPaymentsLoading(true);
    try {
      const [itemsList, paymentsSnap] = await Promise.all([
        listInstallmentItems(tenantId, installment.id),
        getDocs(
          query(
            collection(
              db,
              "tenants",
              tenantId,
              "installments",
              installment.id,
              "payments"
            ),
            orderBy("paidAt", "desc")
          )
        ),
      ]);
      setItems(itemsList);
      setPayments(
        paymentsSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<
            (typeof payments)[number],
            "id"
          >),
        }))
      );
    } catch (err: any) {
      setDrawerError(err?.message ?? "No se pudo cargar el periodo.");
    } finally {
      setItemsLoading(false);
      setPaymentsLoading(false);
    }
  };

  useEffect(() => {
    if (!drawerOpen || !selectedInstallment) return;
    loadDetails(selectedInstallment);
  }, [drawerOpen, selectedInstallment]);

  if (loading || pageLoading) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
        Cargando...
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (pageError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        Ocurrio un error. Intenta de nuevo.
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        Necesitas un tenant para continuar.
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-zinc-900">Canon/Mes</h1>
        <p className="text-sm text-zinc-600">
          Vista global de periodos por contrato.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs font-medium text-zinc-600">Estado</label>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as (typeof statusOptions)[number]["value"]
              )
            }
            className="mt-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-medium text-zinc-600">Mes</label>
          <input
            type="month"
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
            className="mt-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
          />
        </div>
        <div className="flex flex-1 flex-col min-w-[200px]">
          <label className="text-xs font-medium text-zinc-600">Busqueda</label>
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="mt-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
            placeholder="Propiedad, locatario, propietario"
          />
        </div>
        <div className="flex flex-1 flex-col min-w-[200px]">
          <label className="text-xs font-medium text-zinc-600">
            Propietario/a
          </label>
          <input
            type="text"
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
            className="mt-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
            placeholder="Nombre del propietario"
          />
        </div>
      </div>

      {installmentsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {installmentsError}
        </div>
      )}

      {installmentsLoading ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          Cargando...
        </div>
      ) : filteredInstallments.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
          No hay períodos para este mes/filtro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full text-sm text-zinc-700">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Periodo</th>
                <th className="px-3 py-2 text-left font-medium">Estado</th>
                <th className="px-3 py-2 text-left font-medium">Vencimiento</th>
                <th className="px-3 py-2 text-left font-medium">Total</th>
                <th className="px-3 py-2 text-left font-medium">Pagado</th>
                <th className="px-3 py-2 text-left font-medium">Saldo</th>
                <th className="px-3 py-2 text-left font-medium">Contrato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {filteredInstallments.map((installment) => {
                const contract = installment.contractId
                  ? contractsById[installment.contractId]
                  : undefined;
                const installmentProperty = (installment as {
                  property?: { title?: string; address?: string };
                }).property;
                const installmentParties = (installment as {
                  parties?: {
                    owner?: { fullName?: string };
                    tenant?: { fullName?: string };
                  };
                }).parties;
                const propertyTitle =
                  installmentProperty?.title ?? contract?.property?.title ?? "-";
                const propertyAddress =
                  installmentProperty?.address ?? contract?.property?.address ?? "-";
                const ownerName =
                  installmentParties?.owner?.fullName ??
                  contract?.parties?.owner?.fullName ??
                  "-";
                const tenantName =
                  installmentParties?.tenant?.fullName ??
                  contract?.parties?.tenant?.fullName ??
                  "-";
                const dueDate = toDateSafe(installment.dueDate);
                return (
                  <tr
                    key={installment.id}
                    className="bg-white cursor-pointer hover:bg-zinc-50"
                    onClick={() => openDrawer(installment.id)}
                  >
                    <td className="px-3 py-2 font-medium text-zinc-900">
                      {installment.period ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-xs uppercase text-zinc-600">
                      {installment.status ?? "-"}
                    </td>
                    <td className="px-3 py-2">
                      {dueDate ? dueDate.toLocaleDateString() : "-"}
                    </td>
                    <td className="px-3 py-2">
                      {formatAmount(installment.totals?.total)}
                    </td>
                    <td className="px-3 py-2">
                      {formatAmount(installment.totals?.paid)}
                    </td>
                    <td className="px-3 py-2">
                      {formatAmount(installment.totals?.due)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-zinc-500">
                        <div className="font-medium text-zinc-900">
                          {propertyTitle}
                        </div>
                        <div>{propertyAddress}</div>
                        <div>
                          {ownerName} / {tenantName}
                        </div>
                        {installment.contractId && (
                          <Link
                            href={`/contracts/${installment.contractId}`}
                            className="text-xs font-semibold text-zinc-700 hover:text-zinc-900"
                            onClick={(event) => event.stopPropagation()}
                          >
                            Abrir contrato
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openDrawer(installment.id, "payments");
                          }}
                          className="mt-2 block text-xs font-semibold text-zinc-700 hover:text-zinc-900"
                        >
                          Registrar pago
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drawerOpen && selectedInstallment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-3xl rounded-lg bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                Detalle del periodo
              </h3>
              <button
                type="button"
                onClick={closeDrawer}
                className="text-sm text-zinc-500 hover:text-zinc-700"
              >
                Cerrar
              </button>
            </div>
            {drawerError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {drawerError}
              </div>
            )}
            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
              <div className="flex flex-wrap gap-4">
                <div>
                  <span className="font-medium text-zinc-900">Periodo:</span>{" "}
                  {selectedInstallment.period ?? "-"}
                </div>
                <div>
                  <span className="font-medium text-zinc-900">Vencimiento:</span>{" "}
                  {toDateSafe(selectedInstallment.dueDate)?.toLocaleDateString() ??
                    "-"}
                </div>
                <div>
                  <span className="font-medium text-zinc-900">Estado:</span>{" "}
                  {selectedInstallment.status ?? "-"}
                </div>
                <div>
                  <span className="font-medium text-zinc-900">Total:</span>{" "}
                  {formatAmount(selectedInstallment.totals?.total)}
                </div>
                <div>
                  <span className="font-medium text-zinc-900">Pagado:</span>{" "}
                  {formatAmount(selectedInstallment.totals?.paid)}
                </div>
                <div>
                  <span className="font-medium text-zinc-900">Saldo:</span>{" "}
                  {formatAmount(selectedInstallment.totals?.due)}
                </div>
                {selectedInstallment.contractId && (
                  <div>
                    <span className="font-medium text-zinc-900">Contrato:</span>{" "}
                    <Link
                      href={`/contracts/${selectedInstallment.contractId}`}
                      className="text-zinc-700 hover:text-zinc-900"
                    >
                      Abrir contrato
                    </Link>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveSection("items")}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  activeSection === "items"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                Items
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("payments")}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  activeSection === "payments"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                Pagos
              </button>
            </div>

            {activeSection === "items" && (
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border border-zinc-200 bg-white p-4">
                  <div className="text-xs font-semibold text-zinc-500">
                    Agregar gasto/item
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <input
                      type="text"
                      value={itemLabel}
                      onChange={(event) => setItemLabel(event.target.value)}
                      className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                      placeholder="Concepto"
                    />
                    <input
                      type="number"
                      value={itemAmount}
                      onChange={(event) => setItemAmount(event.target.value)}
                      className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                      placeholder="Monto"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={itemSaving}
                    onClick={async () => {
                      if (!tenantId || !selectedInstallment) return;
                      setItemSaving(true);
                      setDrawerError(null);
                      try {
                        const amountValue = Number(itemAmount);
                        if (!itemLabel.trim()) {
                          throw new Error("El concepto es obligatorio.");
                        }
                        if (!Number.isFinite(amountValue) || amountValue === 0) {
                          throw new Error("El monto debe ser distinto de 0.");
                        }
                        await upsertInstallmentItem(tenantId, selectedInstallment.id, {
                          type: "OTRO",
                          label: itemLabel,
                          amount: amountValue,
                        });
                        setItemLabel("");
                        setItemAmount("");
                        await loadDetails(selectedInstallment);
                        const nextInstallments = await fetchInstallments(
                          tenantId,
                          monthFilter
                        );
                        setInstallments(nextInstallments);
                      } catch (err: any) {
                        setDrawerError(err?.message ?? "No se pudo agregar item.");
                      } finally {
                        setItemSaving(false);
                      }
                    }}
                    className="mt-3 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed"
                  >
                    {itemSaving ? "Guardando..." : "Guardar item"}
                  </button>
                </div>

                <div className="rounded-lg border border-zinc-200 bg-white p-4">
                  <div className="text-xs font-semibold text-zinc-500">Items</div>
                  {itemsLoading ? (
                    <div className="mt-2 text-sm text-zinc-600">Cargando...</div>
                  ) : items.length === 0 ? (
                    <div className="mt-2 text-sm text-zinc-600">
                      Sin items cargados.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2 text-sm text-zinc-700">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2"
                        >
                          <div>
                            <div className="text-xs text-zinc-500">
                              {item.type}
                            </div>
                            <div className="font-medium text-zinc-900">
                              {item.label}
                            </div>
                          </div>
                          <div>{formatAmount(item.amount)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeSection === "payments" && (
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border border-zinc-200 bg-white p-4">
                  <div className="text-xs font-semibold text-zinc-500">
                    Registrar pago
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <input
                      type="number"
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                      className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                      placeholder="Monto"
                    />
                    <input
                      type="datetime-local"
                      value={paymentPaidAt}
                      onChange={(event) => setPaymentPaidAt(event.target.value)}
                      className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                    />
                    <select
                      value={paymentMethod}
                      onChange={(event) =>
                        setPaymentMethod(event.target.value as PaymentMethod)
                      }
                      className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                    >
                      <option value="EFECTIVO">Efectivo</option>
                      <option value="TRANSFERENCIA">Transferencia</option>
                      <option value="TARJETA">Tarjeta</option>
                      <option value="OTRO">Otro</option>
                    </select>
                    <input
                      type="text"
                      value={paymentNote}
                      onChange={(event) => setPaymentNote(event.target.value)}
                      className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                      placeholder="Nota"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={paymentSaving}
                    onClick={async () => {
                      if (!tenantId || !selectedInstallment || !user) return;
                      setPaymentSaving(true);
                      setDrawerError(null);
                      try {
                        const amountValue = Number(paymentAmount);
                        if (!Number.isFinite(amountValue) || amountValue <= 0) {
                          throw new Error("El monto debe ser mayor a 0.");
                        }
                        const paidAtValue = paymentPaidAt
                          ? new Date(paymentPaidAt)
                          : new Date();
                        await registerInstallmentPayment(
                          tenantId,
                          selectedInstallment.id,
                          {
                            amount: amountValue,
                            withoutReceipt: false,
                            method: paymentMethod,
                            collectedBy: user.uid,
                            paidAt: paidAtValue,
                            note: paymentNote || undefined,
                          }
                        );
                        setPaymentAmount("");
                        setPaymentNote("");
                        await loadDetails(selectedInstallment);
                        const nextInstallments = await fetchInstallments(
                          tenantId,
                          monthFilter
                        );
                        setInstallments(nextInstallments);
                      } catch (err: any) {
                        setDrawerError(err?.message ?? "No se pudo registrar pago.");
                      } finally {
                        setPaymentSaving(false);
                      }
                    }}
                    className="mt-3 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed"
                  >
                    {paymentSaving ? "Guardando..." : "Guardar pago"}
                  </button>
                </div>

                <div className="rounded-lg border border-zinc-200 bg-white p-4">
                  <div className="text-xs font-semibold text-zinc-500">Pagos</div>
                  {paymentsLoading ? (
                    <div className="mt-2 text-sm text-zinc-600">Cargando...</div>
                  ) : payments.length === 0 ? (
                    <div className="mt-2 text-sm text-zinc-600">
                      Sin pagos registrados.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2 text-sm text-zinc-700">
                      {payments.map((payment) => {
                        const paidAt = toDateSafe(payment.paidAt);
                        return (
                          <div
                            key={payment.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2"
                          >
                            <div>
                              <div className="text-xs text-zinc-500">
                                {payment.method ?? "OTRO"}
                              </div>
                              <div className="font-medium text-zinc-900">
                                {paidAt ? paidAt.toLocaleString() : "-"}
                              </div>
                              {payment.note && (
                                <div className="text-xs text-zinc-500">
                                  {payment.note}
                                </div>
                              )}
                            </div>
                            <div>{formatAmount(payment.amount)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
