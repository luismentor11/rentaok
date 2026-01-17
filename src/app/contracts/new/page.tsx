"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { listProperties, Property } from "@/lib/db/properties";
import { createContract, updateContract } from "@/lib/db/contracts";
import { uploadContractPdf } from "@/lib/storage/contracts";
import {
  defaultNotificationConfig,
  guaranteeTypeLabels,
  normalizeGuaranteeType,
} from "@/lib/model/v1";
import type { GuaranteeType, UpdateRuleType } from "@/lib/model/v1";
import { recordAiError } from "@/lib/debug";

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

type AiConfidence = "alto" | "medio" | "bajo";

type AiImportResponse = {
  contract: {
    owner: { fullName: string; dni?: string; phone?: string; email?: string };
    tenant: { fullName: string; dni?: string; phone?: string; email?: string };
    property: {
      address: string;
      unit?: string;
      city?: string;
      province?: string;
    };
    dates: { startDate: string; endDate: string };
    rent: { amount: number | null; currency: string; dueDay?: number | null };
    deposit?: { amount?: number | null; currency?: string };
    guarantee: {
      type: GuaranteeType;
      details?: string;
    };
  };
  confidence: {
    owner: AiConfidence;
    tenant: AiConfidence;
    property: AiConfidence;
    dates: AiConfidence;
    rent: AiConfidence;
    deposit: AiConfidence;
    guarantee: AiConfidence;
  };
  warnings?: string[];
};

type GuarantorInput = {
  fullName: string;
  dni: string;
  address: string;
  email: string;
  whatsapp: string;
};

const normalizeAiImport = (
  value?: Partial<AiImportResponse> | null
): AiImportResponse => {
  const contract = value?.contract ?? ({} as Partial<AiImportResponse["contract"]>);
  const owner =
    contract.owner ?? ({} as Partial<AiImportResponse["contract"]["owner"]>);
  const tenant =
    contract.tenant ?? ({} as Partial<AiImportResponse["contract"]["tenant"]>);
  const property =
    contract.property ?? ({} as Partial<AiImportResponse["contract"]["property"]>);
  const dates =
    contract.dates ?? ({} as Partial<AiImportResponse["contract"]["dates"]>);
  const rent =
    contract.rent ?? ({} as Partial<AiImportResponse["contract"]["rent"]>);
  const deposit = (contract.deposit ?? {}) as {
    amount?: number | null;
    currency?: string;
  };
  const guarantee =
    contract.guarantee ??
    ({} as Partial<AiImportResponse["contract"]["guarantee"]>);
  const confidence =
    value?.confidence ?? ({} as Partial<AiImportResponse["confidence"]>);
  return {
    contract: {
      owner: {
        fullName: owner.fullName ?? "",
        dni: owner.dni ?? "",
        phone: owner.phone ?? "",
        email: owner.email ?? "",
      },
      tenant: {
        fullName: tenant.fullName ?? "",
        dni: tenant.dni ?? "",
        phone: tenant.phone ?? "",
        email: tenant.email ?? "",
      },
      property: {
        address: property.address ?? "",
        unit: property.unit ?? "",
        city: property.city ?? "",
        province: property.province ?? "",
      },
      dates: {
        startDate: dates.startDate ?? "",
        endDate: dates.endDate ?? "",
      },
      rent: {
        amount:
          rent.amount !== null && rent.amount !== undefined ? rent.amount : null,
        currency: rent.currency ?? "ARS",
        dueDay: rent.dueDay ?? null,
      },
      deposit: {
        amount:
          deposit.amount !== null && deposit.amount !== undefined
            ? deposit.amount
            : null,
        currency: deposit.currency ?? "ARS",
      },
      guarantee: {
        type: guarantee.type ?? "OTRO",
        details: guarantee.details,
      },
    },
    confidence: {
      owner: confidence.owner ?? "bajo",
      tenant: confidence.tenant ?? "bajo",
      property: confidence.property ?? "bajo",
      dates: confidence.dates ?? "bajo",
      rent: confidence.rent ?? "bajo",
      deposit: confidence.deposit ?? "bajo",
      guarantee: confidence.guarantee ?? "bajo",
    },
    warnings: value?.warnings,
  };
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
  const [isDraft, setIsDraft] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiStep, setAiStep] = useState<"upload" | "processing" | "result">(
    "upload"
  );
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiResult, setAiResult] = useState<AiImportResponse | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

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

  const openAiModal = () => {
    setAiError(null);
    setAiResult(null);
    setAiFile(null);
    setAiStep("upload");
    setAiModalOpen(true);
  };

  const closeAiModal = () => {
    if (aiStep === "processing") return;
    setAiModalOpen(false);
  };

  const applyAiResult = (result: AiImportResponse, file: File | null) => {
    const { contract } = result;
    setOwnerName(contract.owner.fullName || "");
    setOwnerDni(contract.owner.dni ?? "");
    setOwnerEmail(contract.owner.email ?? "");
    setOwnerWhatsapp(contract.owner.phone ?? "");

    setTenantName(contract.tenant.fullName || "");
    setTenantDni(contract.tenant.dni ?? "");
    setTenantEmail(contract.tenant.email ?? "");
    setTenantWhatsapp(contract.tenant.phone ?? "");

    if (propertySelection === "manual") {
      const address = contract.property.address ?? "";
      setPropertyAddress(address);
      setPropertyTitle((prev) => (prev.trim() ? prev : address || "Propiedad"));
    }

    setStartDate(contract.dates.startDate || "");
    setEndDate(contract.dates.endDate || "");
    setRentAmount(
      contract.rent.amount !== null && contract.rent.amount !== undefined
        ? String(contract.rent.amount)
        : ""
    );
    setDueDay(
      contract.rent.dueDay !== null && contract.rent.dueDay !== undefined
        ? String(contract.rent.dueDay)
        : ""
    );
    setDepositAmount(
      contract.deposit?.amount !== null &&
        contract.deposit?.amount !== undefined
        ? String(contract.deposit.amount)
        : ""
    );
    setGuaranteeType(normalizeGuaranteeType(contract.guarantee.type));
    if (file) {
      setContractPdf(file);
    }
  };

  const handleAiImport = async () => {
    if (!aiFile) return;
    setAiError(null);
    setAiStep("processing");
    try {
      const formData = new FormData();
      formData.append("file", aiFile);
      const response = await fetch("/api/ai/contracts/import", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof payload?.message === "string"
            ? payload.message
            : "No pudimos analizar el PDF. Proba de nuevo.";
        throw new Error(message);
      }
      if (!payload?.ok) {
        const message =
          typeof payload?.message === "string"
            ? payload.message
            : "No pudimos analizar el PDF. Proba de nuevo.";
        throw new Error(message);
      }
      const normalized = normalizeAiImport(payload?.draft ?? payload);
      setAiResult(normalized);
      setAiStep("result");
    } catch (err) {
      console.error("Contracts:AI import", err);
      recordAiError("ai:contracts:import", err);
      const fallback = "No pudimos analizar el PDF. Proba de nuevo.";
      const message =
        err instanceof Error && err.message
          ? err.message
          : fallback;
      setAiError(message);
      setAiStep("upload");
    }
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
        status: isDraft ? "draft" : "active",
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

  const getConfidenceTone = (value: AiConfidence) => {
    if (value === "alto") return "bg-emerald-100 text-emerald-700";
    if (value === "medio") return "bg-amber-100 text-amber-700";
    return "bg-zinc-100 text-zinc-700";
  };

  if (loading || pageLoading) {
    return <div className="text-sm text-zinc-600">Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">
            Nuevo contrato
          </h1>
          <p className="text-sm text-zinc-600">
            Completa los datos del contrato.
          </p>
        </div>
        <button
          type="button"
          onClick={openAiModal}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
        >
          Cargar desde PDF
        </button>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {isDraft && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Borrador con datos importados. Revisa antes de guardar.
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
            <div className="relative mt-2">
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              />
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M8 2v4M16 2v4M3 10h18" />
              </svg>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Fin</label>
            <div className="relative mt-2">
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              />
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M8 2v4M16 2v4M3 10h18" />
              </svg>
            </div>
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
            <div className="relative mt-2">
              <input
                type="number"
                value={rentAmount}
                onChange={(event) => setRentAmount(event.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                placeholder="250000"
              />
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 6h8a4 4 0 0 1 0 8H8" />
                <path d="M8 14h7a3 3 0 0 1 0 6H6" />
              </svg>
            </div>
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
            <div className="relative mt-2">
              <input
                type="number"
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                placeholder="0"
              />
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 6h8a4 4 0 0 1 0 8H8" />
                <path d="M8 14h7a3 3 0 0 1 0 6H6" />
              </svg>
            </div>
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
        {submitting ? (
          <span className="inline-flex items-center gap-2">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4 animate-spin"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                className="opacity-75"
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
            Guardando...
          </span>
        ) : isDraft ? (
          "Guardar borrador"
        ) : (
          "Crear contrato"
        )}
      </button>
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">
                Cargar contrato desde PDF
              </h2>
              <button
                type="button"
                onClick={closeAiModal}
                disabled={aiStep === "processing"}
                className="rounded-md px-2 py-1 text-xs font-semibold text-zinc-500 hover:text-zinc-700 disabled:text-zinc-300"
              >
                Cerrar
              </button>
            </div>
            <div className="mt-4 space-y-4">
              {aiStep === "upload" && (
                <>
                  <p className="text-sm text-zinc-600">
                    Subi el PDF y dejamos el contrato prellenado como borrador.
                  </p>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setAiFile(file);
                      setAiError(null);
                    }}
                    className="text-sm"
                  />
                  {aiFile && (
                    <div className="text-xs text-zinc-500">{aiFile.name}</div>
                  )}
                  {aiError && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      {aiError}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeAiModal}
                      className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleAiImport}
                      disabled={!aiFile}
                      className="rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                    >
                      Analizar PDF
                    </button>
                  </div>
                </>
              )}
              {aiStep === "processing" && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600">
                  <div className="mx-auto mb-3 h-2 w-2 animate-pulse rounded-full bg-zinc-400" />
                  Analizando PDF...
                </div>
              )}
              {aiStep === "result" && aiResult && (
                <>
                  <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-800">
                        Propietario
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getConfidenceTone(
                          aiResult.confidence.owner
                        )}`}
                      >
                        {aiResult.confidence.owner}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-600">
                      {[
                        aiResult.contract.owner.fullName &&
                          `Nombre: ${aiResult.contract.owner.fullName}`,
                        aiResult.contract.owner.dni &&
                          `DNI: ${aiResult.contract.owner.dni}`,
                        aiResult.contract.owner.email &&
                          `Email: ${aiResult.contract.owner.email}`,
                        aiResult.contract.owner.phone &&
                          `WhatsApp: ${aiResult.contract.owner.phone}`,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "Sin datos"}
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-800">
                        Locatario
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getConfidenceTone(
                          aiResult.confidence.tenant
                        )}`}
                      >
                        {aiResult.confidence.tenant}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-600">
                      {[
                        aiResult.contract.tenant.fullName &&
                          `Nombre: ${aiResult.contract.tenant.fullName}`,
                        aiResult.contract.tenant.dni &&
                          `DNI: ${aiResult.contract.tenant.dni}`,
                        aiResult.contract.tenant.email &&
                          `Email: ${aiResult.contract.tenant.email}`,
                        aiResult.contract.tenant.phone &&
                          `WhatsApp: ${aiResult.contract.tenant.phone}`,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "Sin datos"}
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-800">
                        Propiedad
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getConfidenceTone(
                          aiResult.confidence.property
                        )}`}
                      >
                        {aiResult.confidence.property}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-600">
                      {[
                        aiResult.contract.property.address &&
                          `Direccion: ${aiResult.contract.property.address}`,
                        aiResult.contract.property.unit &&
                          `Unidad: ${aiResult.contract.property.unit}`,
                        aiResult.contract.property.city &&
                          `Ciudad: ${aiResult.contract.property.city}`,
                        aiResult.contract.property.province &&
                          `Provincia: ${aiResult.contract.property.province}`,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "Sin datos"}
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-800">Fechas</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getConfidenceTone(
                          aiResult.confidence.dates
                        )}`}
                      >
                        {aiResult.confidence.dates}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-600">
                      {[
                        aiResult.contract.dates.startDate &&
                          `Inicio: ${aiResult.contract.dates.startDate}`,
                        aiResult.contract.dates.endDate &&
                          `Fin: ${aiResult.contract.dates.endDate}`,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "Sin datos"}
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-800">
                        Canon
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getConfidenceTone(
                          aiResult.confidence.rent
                        )}`}
                      >
                        {aiResult.confidence.rent}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-600">
                      {[
                        aiResult.contract.rent.amount !== null &&
                          aiResult.contract.rent.amount !== undefined &&
                          `Monto: ${aiResult.contract.rent.amount}`,
                        aiResult.contract.rent.currency &&
                          `Moneda: ${aiResult.contract.rent.currency}`,
                        aiResult.contract.rent.dueDay !== null &&
                          aiResult.contract.rent.dueDay !== undefined &&
                          `Vencimiento: ${aiResult.contract.rent.dueDay}`,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "Sin datos"}
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-800">
                        Deposito
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getConfidenceTone(
                          aiResult.confidence.deposit
                        )}`}
                      >
                        {aiResult.confidence.deposit}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-600">
                      {[
                        aiResult.contract.deposit?.amount !== null &&
                          aiResult.contract.deposit?.amount !== undefined &&
                          `Monto: ${aiResult.contract.deposit.amount}`,
                        aiResult.contract.deposit?.currency &&
                          `Moneda: ${aiResult.contract.deposit.currency}`,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "Sin datos"}
                    </div>
                  </div>
                  <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-800">
                        Garantia
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getConfidenceTone(
                          aiResult.confidence.guarantee
                        )}`}
                      >
                        {aiResult.confidence.guarantee}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-600">
                      {[
                        aiResult.contract.guarantee.type &&
                          `Tipo: ${
                            guaranteeTypeLabels[
                              normalizeGuaranteeType(
                                aiResult.contract.guarantee.type
                              )
                            ]
                          }`,
                        aiResult.contract.guarantee.details &&
                          `Detalle: ${aiResult.contract.guarantee.details}`,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "Sin datos"}
                    </div>
                  </div>
                  {aiResult.warnings && aiResult.warnings.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      {aiResult.warnings.join(" / ")}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAiStep("upload");
                      }}
                      className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
                    >
                      Volver
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        applyAiResult(aiResult, aiFile);
                        setIsDraft(true);
                        setAiModalOpen(false);
                      }}
                      className="rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
                    >
                      Crear borrador
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
