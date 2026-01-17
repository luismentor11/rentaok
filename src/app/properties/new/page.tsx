"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { createProperty } from "@/lib/db/properties";

const statusOptions = [
  { value: "available", label: "Disponible" },
  { value: "rented", label: "Alquilada" },
];

export default function NewPropertyPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<"available" | "rented">("available");
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
        }
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

  const handleSubmit = async () => {
    if (!tenantId || !user) return;
    setSubmitting(true);
    setError(null);
    try {
      await createProperty(tenantId, {
        title: title.trim(),
        address: address.trim(),
        status,
        createdByUid: user.uid,
      });
      router.replace("/properties");
    } catch (err: any) {
      setError(err?.message ?? "No se pudo crear la propiedad.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || pageLoading) {
    return <div className="text-sm text-zinc-600">Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <section className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          Nueva propiedad
        </h1>
        <p className="text-sm text-zinc-600">Carga los datos basicos.</p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-zinc-700">Titulo</label>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
          placeholder="Departamento 2 ambientes"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Direccion
        </label>
        <input
          type="text"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
          placeholder="Av. Siempre Viva 123"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">Estado</label>
        <select
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as "available" | "rented")
          }
          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !title.trim() || !address.trim()}
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
        ) : (
          "Crear propiedad"
        )}
      </button>
    </section>
  );
}
