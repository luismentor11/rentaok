"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { db } from "@/lib/firebase";

type OfficeSettings = {
  officeName: string;
  contactEmail: string;
  whatsapp: string;
};

type ReminderSettings = {
  enabled: boolean;
  daysBeforeDue: number;
  daysAfterDue: number;
  applyLateFee: boolean;
};

type TenantSettings = {
  office: OfficeSettings;
  reminders: ReminderSettings;
  updatedAt?: unknown;
};

const defaultSettings: TenantSettings = {
  office: {
    officeName: "",
    contactEmail: "",
    whatsapp: "",
  },
  reminders: {
    enabled: false,
    daysBeforeDue: 5,
    daysAfterDue: 1,
    applyLateFee: false,
  },
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [settings, setSettings] = useState<TenantSettings>(defaultSettings);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [savingOffice, setSavingOffice] = useState(false);
  const [savingReminders, setSavingReminders] = useState(false);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [remindersError, setRemindersError] = useState<string | null>(null);

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
      setPageError(null);
      try {
        const profile = await getUserProfile(user.uid);
        if (!active) return;
        const nextTenantId = profile?.tenantId ?? null;
        setTenantId(nextTenantId);
        if (!nextTenantId) {
          router.replace("/onboarding");
          return;
        }
        const ref = doc(db, "tenants", nextTenantId, "settings", "general");
        const snap = await getDoc(ref);
        if (!active) return;
        if (snap.exists()) {
          const data = snap.data() as Partial<TenantSettings>;
          setSettings({
            office: { ...defaultSettings.office, ...(data.office ?? {}) },
            reminders: {
              ...defaultSettings.reminders,
              ...(data.reminders ?? {}),
            },
          });
        } else {
          setSettings(defaultSettings);
        }
      } catch (err: any) {
        if (!active) return;
        setPageError(err?.message ?? "No se pudo cargar la configuracion.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [user, loading, router]);

  const handleOfficeSave = async () => {
    if (!tenantId) return;
    setSavingOffice(true);
    setOfficeError(null);
    try {
      const officeName = settings.office.officeName.trim();
      const contactEmail = settings.office.contactEmail.trim();
      const whatsapp = settings.office.whatsapp.trim();
      if (!officeName) {
        setOfficeError("El nombre de la oficina es obligatorio.");
        return;
      }
      if (!contactEmail) {
        setOfficeError("El email de contacto es obligatorio.");
        return;
      }
      if (!emailPattern.test(contactEmail)) {
        setOfficeError("El email de contacto no es valido.");
        return;
      }
      if (!whatsapp) {
        setOfficeError("El WhatsApp es obligatorio.");
        return;
      }
      const ref = doc(db, "tenants", tenantId, "settings", "general");
      await setDoc(
        ref,
        {
          office: {
            officeName,
            contactEmail,
            whatsapp,
          },
          reminders: settings.reminders,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err: any) {
      setOfficeError(err?.message ?? "No se pudo guardar la oficina.");
    } finally {
      setSavingOffice(false);
    }
  };

  const handleRemindersSave = async () => {
    if (!tenantId) return;
    setSavingReminders(true);
    setRemindersError(null);
    try {
      const daysBeforeDue = Number(settings.reminders.daysBeforeDue);
      const daysAfterDue = Number(settings.reminders.daysAfterDue);
      if (!Number.isFinite(daysBeforeDue) || daysBeforeDue < 0) {
        setRemindersError("Los dias antes deben ser 0 o mayores.");
        return;
      }
      if (!Number.isFinite(daysAfterDue) || daysAfterDue < 0) {
        setRemindersError("Los dias despues deben ser 0 o mayores.");
        return;
      }
      const ref = doc(db, "tenants", tenantId, "settings", "general");
      await setDoc(
        ref,
        {
          office: settings.office,
          reminders: {
            ...settings.reminders,
            daysBeforeDue,
            daysAfterDue,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err: any) {
      setRemindersError(err?.message ?? "No se pudo guardar recordatorios.");
    } finally {
      setSavingReminders(false);
    }
  };

  const officeNameValue = settings.office.officeName.trim();
  const contactEmailValue = settings.office.contactEmail.trim();
  const whatsappValue = settings.office.whatsapp.trim();
  const isOfficeValid =
    Boolean(officeNameValue) &&
    Boolean(contactEmailValue) &&
    emailPattern.test(contactEmailValue) &&
    Boolean(whatsappValue);

  const remindersBeforeValue = Number(settings.reminders.daysBeforeDue);
  const remindersAfterValue = Number(settings.reminders.daysAfterDue);
  const isRemindersValid =
    Number.isFinite(remindersBeforeValue) &&
    remindersBeforeValue >= 0 &&
    Number.isFinite(remindersAfterValue) &&
    remindersAfterValue >= 0;

  if (loading || pageLoading) {
    return <div className="text-sm text-zinc-600">Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  if (pageError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {pageError}
      </div>
    );
  }

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Configuracion</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Ajustes operativos para tu tenant.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            Datos de la oficina
          </h2>
          <p className="text-xs text-zinc-500">
            Se usan en comunicaciones y documentos.
          </p>
        </div>
        {officeError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {officeError}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-zinc-700">
              Nombre de la oficina
            </label>
            <input
              type="text"
              value={settings.office.officeName}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  office: { ...prev.office, officeName: event.target.value },
                }))
              }
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="RentaOK"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Email de contacto
            </label>
            <input
              type="email"
              value={settings.office.contactEmail}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  office: { ...prev.office, contactEmail: event.target.value },
                }))
              }
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="contacto@rentaok.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              WhatsApp
            </label>
            <input
              type="text"
              value={settings.office.whatsapp}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  office: { ...prev.office, whatsapp: event.target.value },
                }))
              }
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="+54 11 1234 5678"
            />
          </div>
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleOfficeSave}
            disabled={savingOffice || !isOfficeValid}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {savingOffice ? (
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
            ) : (
              "Guardar"
            )}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            Recordatorios automaticos
          </h2>
          <p className="text-xs text-zinc-500">
            Configura reglas base de vencimientos.
          </p>
        </div>
        {remindersError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {remindersError}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-900">
              Activar recordatorios
            </div>
            <div className="text-xs text-zinc-500">
              Se aplica a todos los contratos.
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-600">
            <input
              type="checkbox"
              checked={settings.reminders.enabled}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  reminders: {
                    ...prev.reminders,
                    enabled: event.target.checked,
                  },
                }))
              }
            />
            {settings.reminders.enabled ? "Activo" : "Inactivo"}
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Dias antes del vencimiento
            </label>
            <input
              type="number"
              min={0}
              value={settings.reminders.daysBeforeDue}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  reminders: {
                    ...prev.reminders,
                    daysBeforeDue: Number(event.target.value),
                  },
                }))
              }
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="5"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Dias despues del vencimiento
            </label>
            <input
              type="number"
              min={0}
              value={settings.reminders.daysAfterDue}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  reminders: {
                    ...prev.reminders,
                    daysAfterDue: Number(event.target.value),
                  },
                }))
              }
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
              placeholder="1"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={settings.reminders.applyLateFee}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    reminders: {
                      ...prev.reminders,
                      applyLateFee: event.target.checked,
                    },
                  }))
                }
              />
              Aplicar mora
            </label>
          </div>
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleRemindersSave}
            disabled={savingReminders || !isRemindersValid}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {savingReminders ? (
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
            ) : (
              "Guardar"
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
