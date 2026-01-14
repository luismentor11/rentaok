"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { listProperties, Property } from "@/lib/db/properties";
import { createContract, updateContract } from "@/lib/db/contracts";
import { uploadContractPdf } from "@/lib/storage/contracts";
import { defaultNotificationConfig, guaranteeTypeLabels } from "@/lib/model/v1";
import type { GuaranteeType, UpdateRuleType } from "@/lib/model/v1";

const updateRuleOptions: { value: UpdateRuleType; label: string }[] = [
  { value: "IPC", label: "IPC" },
  { value: "ICL", label: "ICL" },
  { value: "FIJO", label: "Fijo" },
  { value: "MANUAL", label: "Manual" },
];

const guaranteeOptions: { value: GuaranteeType; label: string }[] = [
  { value: "GARANTES", label: guaranteeTypeLabels.GARANTES },
  { value: "CAUCION", label: guaranteeTypeLabels.CAUCION },
  {
    value: "CONVENIO_DESALOJO",
    label: guaranteeTypeLabels.CONVENIO_DESALOJO,
  },
  { value: "OTRO", label: guaranteeTypeLabels.OTRO },
];

type GuarantorInput = {
  fullName: string;
  dni: string;
  address: string;
  email: string;
  whatsapp: string;
};

export default function NewContractPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertySelection, setPropertySelection] = useState("manual");
  const [propertyTitle, setPropertyTitle] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [autoSelectedProperty, setAutoSelectedProperty] = useState(false);
  const [tenantName, setTenantName] = useState("");
  const [tenantDni, setTenantDni] = useState("");
  const [tenantEmail, setTenantEmail] = useState("");
  const [tenantWhatsapp, setTenantWhatsapp] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerDni, setOwnerDni] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState("");
  const [guarantors, setGuarantors] = useState<GuarantorInput[]>([
    { fullName: "", dni: "", address: "", email: "", whatsapp: "" },
  ]);
  const [contractPdf, setContractPdf] = useState<File | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [updateRuleType, setUpdateRuleType] = useState<UpdateRuleType>("IPC");
  const [updateRulePeriod, setUpdateRulePeriod] = useState("12");
  const [depositAmount, setDepositAmount] = useState("");
  const [guaranteeType, setGuaranteeType] =
    useState<GuaranteeType>("GARANTES");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || loading) return;
    let active = true;
    const load = async () => {
      setPageLoading(true);
      setError(null);
      try {
        const profile = await getUserProfile(user.uid);
        if (!active) return;
        const nextTenantId = profile?.tenantId ?? null;
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          router.replace("/onboarding");
          return;
        }
        const list = await listProperties(nextTenantId);
        if (!active) return;
        setProperties(list);
      } catch (err: any) {
        if (!active) return;
        setError(err?.message ?? "No se pudo cargar el perfil.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [user, loading, router]);

  useEffect(() => {
    if (properties.length === 0) return;
    if (propertySelection !== "manual") return;
    if (autoSelectedProperty) return;
    const first = properties[0];
    setPropertySelection(first.id);
    setPropertyTitle(first.title);
    setPropertyAddress(first.address);
    setAutoSelectedProperty(true);
  }, [properties, propertySelection, autoSelectedProperty]);

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === propertySelection) ?? null,
    [properties, propertySelection]
  );

  const handlePropertySelection = (value: string) => {
    setPropertySelection(value);
    if (value === "manual") return;
    const found = properties.find((property) => property.id === value);
    if (!found) return;
    setPropertyTitle(found.title);
    setPropertyAddress(found.address);
  };

  const updateGuarantor = (
    index: number,
    field: keyof GuarantorInput,
    value: string
  ) => {
    setGuarantors((current) =>
      current.map((item, idx) =>
        idx === index ? { ...item, [field]: value } : item
      )
    );
  };

  const addGuarantor = () => {
    setGuarantors((current) => [
      ...current,
      { fullName: "", dni: "", address: "", email: "", whatsapp: "" },
    ]);
  };

  const removeGuarantor = (index: number) => {
    setGuarantors((current) => current.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async () => {
    if (!tenantId || !user) return;
    setError(null);

    if (!propertyTitle.trim() || !propertyAddress.trim()) {
      setError("La propiedad es obligatoria.");
      return;
    }
    if (!tenantName.trim()) {
      setError("El locatario es obligatorio.");
      return;
    }
    if (!ownerName.trim()) {
      setError("El propietario es obligatorio.");
      return;
    }
    const trimmedGuarantors = guarantors.map((guarantor) => ({
      fullName: guarantor.fullName.trim(),
      dni: guarantor.dni.trim(),
      address: guarantor.address.trim(),
      email: guarantor.email.trim(),
      whatsapp: guarantor.whatsapp.trim(),
    }));
    const filledGuarantors = trimmedGuarantors.filter(
      (guarantor) =>
        guarantor.fullName ||
        guarantor.dni ||
        guarantor.address ||
        guarantor.email ||
        guarantor.whatsapp
    );
    const validGuarantors = filledGuarantors.filter(
      (guarantor) => guarantor.fullName && guarantor.address
    );
    const missingGuarantorName = filledGuarantors.some(
      (guarantor) => !guarantor.fullName
    );
    const missingGuarantorAddress = filledGuarantors.some(
      (guarantor) => !guarantor.address
    );
    if (guaranteeType === "GARANTES") {
      if (filledGuarantors.length === 0) {
        setError("Debes cargar al menos un garante.");
        return;
      }
      if (missingGuarantorName) {
        setError("Todos los garantes deben tener nombre.");
        return;
      }
      if (missingGuarantorAddress) {
        setError("Todos los garantes deben tener domicilio.");
        return;
      }
    }
    if (!contractPdf) {
      setError("El PDF del contrato es obligatorio.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Las fechas de inicio y fin son obligatorias.");
      return;
    }
    const dueDayValue = Number(dueDay);
    if (!Number.isFinite(dueDayValue) || dueDayValue < 1 || dueDayValue > 31) {
      setError("El dia de vencimiento debe estar entre 1 y 31.");
      return;
    }
    const rentAmountValue = Number(rentAmount);
    if (!Number.isFinite(rentAmountValue) || rentAmountValue <= 0) {
      setError("El monto inicial es obligatorio.");
      return;
    }
    const updateRulePeriodValue = Number(updateRulePeriod);
    if (!Number.isFinite(updateRulePeriodValue) || updateRulePeriodValue <= 0) {
      setError("La periodicidad de actualizacion es obligatoria.");
      return;
    }
    const depositValue = Number(depositAmount || "0");
    if (!Number.isFinite(depositValue) || depositValue < 0) {
      setError("El deposito debe ser valido.");
      return;
    }
    const nextPropertyId =
      propertySelection === "manual"
        ? crypto.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(16).slice(2)}`
        : propertySelection;

    setSubmitting(true);
    try {
      const contractId = await createContract(tenantId, {
        property: {
          id: nextPropertyId,
          title: propertyTitle.trim(),
          address: propertyAddress.trim(),
        },
        parties: {
          tenant: {
            fullName: tenantName.trim(),
            dni: tenantDni.trim() || undefined,
            email: tenantEmail.trim() || undefined,
            whatsapp: tenantWhatsapp.trim() || undefined,
          },
          owner: {
            fullName: ownerName.trim(),
            dni: ownerDni.trim() || undefined,
            email: ownerEmail.trim() || undefined,
            whatsapp: ownerWhatsapp.trim() || undefined,
          },
        },
        guarantors: validGuarantors.map((guarantor) => ({
          fullName: guarantor.fullName,
          dni: guarantor.dni || undefined,
          address: guarantor.address,
          email: guarantor.email || undefined,
          whatsapp: guarantor.whatsapp || undefined,
        })),
        dates: {
          startDate,
          endDate,
        },
        dueDay: dueDayValue,
        rentAmount: rentAmountValue,
        updateRule: {
          type: updateRuleType,
          periodMonths: updateRulePeriodValue,
        },
        depositAmount: depositValue,
        guaranteeType,
        notificationConfig: defaultNotificationConfig,
        createdByUid: user.uid,
      });

      const pdfMeta = await uploadContractPdf(tenantId, contractId, contractPdf);
      await updateContract(tenantId, contractId, { pdf: pdfMeta });
      router.replace(`/contracts/${contractId}`);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo crear el contrato.");
    } finally {
      setSubmitting(false);
    }
  };

  const propertyInputsDisabled = propertySelection !== "manual";
  const dueDayValue = Number(dueDay);
  const rentAmountValue = Number(rentAmount);
  const updateRulePeriodValue = Number(updateRulePeriod);
  const depositValue = Number(depositAmount || "0");
  const guarantorsValid =
    guaranteeType !== "GARANTES" ||
    (guarantors.length > 0 &&
      guarantors.every(
        (guarantor) =>
          Boolean(guarantor.fullName.trim()) &&
          Boolean(guarantor.address.trim())
      ));
  const isFormValid =
    Boolean(propertyTitle.trim()) &&
    Boolean(propertyAddress.trim()) &&
    Boolean(tenantName.trim()) &&
    Boolean(ownerName.trim()) &&
    Boolean(contractPdf) &&
    Boolean(startDate) &&
    Boolean(endDate) &&
    Number.isFinite(dueDayValue) &&
    dueDayValue >= 1 &&
    dueDayValue <= 31 &&
    Number.isFinite(rentAmountValue) &&
    rentAmountValue > 0 &&
    Number.isFinite(updateRulePeriodValue) &&
    updateRulePeriodValue > 0 &&
    Number.isFinite(depositValue) &&
    depositValue >= 0 &&
    guarantorsValid;

  if (loading || pageLoading) {
    return <div className="text-sm text-zinc-600">Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          Nuevo contrato
        </h1>
        <p className="text-sm text-zinc-600">Completa los datos del contrato.</p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Propiedad</h2>
        {properties.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Seleccionar propiedad
            </label>
            <select
              value={propertySelection}
              onChange={(event) => handlePropertySelection(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
            >
              <option value="manual">Nueva propiedad (manual)</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Titulo
            </label>
            <input
              type="text"
              value={propertyTitle}
              onChange={(event) => setPropertyTitle(event.target.value)}
              disabled={propertyInputsDisabled}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-100"
              placeholder="Departamento 2 ambientes"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Direccion
            </label>
            <input
              type="text"
              value={propertyAddress}
              onChange={(event) => setPropertyAddress(event.target.value)}
              disabled={propertyInputsDisabled}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-100"
              placeholder="Av. Siempre Viva 123"
            />
          </div>
        </div>
        {selectedProperty && propertySelection !== "manual" && (
          <p className="text-xs text-zinc-500">
            Propiedad seleccionada: {selectedProperty.title}
          </p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Locatario</h2>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Nombre
            </label>
            <input
              type="text"
              value={tenantName}
              onChange={(event) => setTenantName(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="Juan Perez"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">DNI</label>
            <input
              type="text"
              value={tenantDni}
              onChange={(event) => setTenantDni(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="30123456"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              type="email"
              value={tenantEmail}
              onChange={(event) => setTenantEmail(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="juan@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              WhatsApp
            </label>
            <input
              type="text"
              value={tenantWhatsapp}
              onChange={(event) => setTenantWhatsapp(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="+54 11 1234 5678"
            />
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Propietario</h2>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Nombre
            </label>
            <input
              type="text"
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="Ana Lopez"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">DNI</label>
            <input
              type="text"
              value={ownerDni}
              onChange={(event) => setOwnerDni(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="28999888"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              type="email"
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="ana@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              WhatsApp
            </label>
            <input
              type="text"
              value={ownerWhatsapp}
              onChange={(event) => setOwnerWhatsapp(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="+54 11 4444 8888"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Garantes</h2>
          <button
            type="button"
            onClick={addGuarantor}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
          >
            Agregar garante
          </button>
        </div>
        {guarantors.map((guarantor, index) => (
          <div key={`guarantor-${index}`} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-zinc-700">
                Garante {index + 1}
              </div>
              <button
                type="button"
                onClick={() => removeGuarantor(index)}
                disabled={guarantors.length === 1}
                className="text-xs text-zinc-500 disabled:text-zinc-300"
              >
                Quitar
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="text"
                value={guarantor.fullName}
                onChange={(event) =>
                  updateGuarantor(index, "fullName", event.target.value)
                }
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                placeholder="Nombre"
              />
              <input
                type="text"
                value={guarantor.dni}
                onChange={(event) =>
                  updateGuarantor(index, "dni", event.target.value)
                }
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                placeholder="DNI"
              />
              <input
                type="text"
                value={guarantor.address}
                onChange={(event) =>
                  updateGuarantor(index, "address", event.target.value)
                }
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                placeholder="Domicilio"
              />
              <input
                type="email"
                value={guarantor.email}
                onChange={(event) =>
                  updateGuarantor(index, "email", event.target.value)
                }
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                placeholder="Email"
              />
              <input
                type="text"
                value={guarantor.whatsapp}
                onChange={(event) =>
                  updateGuarantor(index, "whatsapp", event.target.value)
                }
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                placeholder="WhatsApp"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Contrato PDF</h2>
        <input
          type="file"
          accept="application/pdf"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setContractPdf(file);
          }}
          className="text-sm"
        />
        {contractPdf && (
          <div className="text-xs text-zinc-500">{contractPdf.name}</div>
        )}
      </div>

      <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Configuracion</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Inicio
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Fin</label>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Dia vencimiento
            </label>
            <input
              type="number"
              value={dueDay}
              onChange={(event) => setDueDay(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="10"
              min={1}
              max={31}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Monto inicial
            </label>
            <input
              type="number"
              value={rentAmount}
              onChange={(event) => setRentAmount(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="250000"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Regla actualizacion
            </label>
            <select
              value={updateRuleType}
              onChange={(event) =>
                setUpdateRuleType(event.target.value as UpdateRuleType)
              }
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
            >
              {updateRuleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Periodicidad (meses)
            </label>
            <input
              type="number"
              value={updateRulePeriod}
              onChange={(event) => setUpdateRulePeriod(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="12"
              min={1}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Deposito
            </label>
            <input
              type="number"
              value={depositAmount}
              onChange={(event) => setDepositAmount(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Tipo garantia
            </label>
            <select
              value={guaranteeType}
              onChange={(event) =>
                setGuaranteeType(event.target.value as GuaranteeType)
              }
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
            >
              {guaranteeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !isFormValid}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {submitting ? "Guardando..." : "Crear contrato"}
      </button>
    </section>
  );
}
