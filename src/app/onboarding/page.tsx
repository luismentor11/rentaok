"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { createTenantForUser } from "@/lib/db/tenants";

export default function OnboardingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  const handleCreate = async () => {
    if (!user || !tenantName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTenantForUser(user, tenantName.trim());
      router.replace("/");
    } catch (err: any) {
      setError(err?.message ?? "No se pudo crear el tenant.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-zinc-600">Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          Crear tenant
        </h1>
        <p className="text-sm text-zinc-600">
          Necesitamos un nombre para tu cuenta.
        </p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <label className="block text-sm font-medium text-zinc-700">
        Nombre del tenant
      </label>
      <input
        type="text"
        value={tenantName}
        onChange={(event) => setTenantName(event.target.value)}
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
        placeholder="Mi inmobiliaria"
      />
      <button
        type="button"
        onClick={handleCreate}
        disabled={submitting || !tenantName.trim()}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {submitting ? "Creando..." : "Crear y continuar"}
      </button>
    </section>
  );
}
