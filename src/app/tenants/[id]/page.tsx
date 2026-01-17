"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getUserProfile } from "@/lib/db/users";
import { getPerson, updatePerson } from "@/lib/db/tenantsPeople";

type PageProps = {
  params: { id: string };
};

export default function TenantPersonDetailPage({ params }: PageProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [dni, setDni] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

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
        const person = await getPerson(nextTenantId, params.id);
        if (!active) return;
        if (!person) {
          setError("Inquilino no encontrado.");
          return;
        }
        setFullName(person.fullName);
        setDni(person.dni ?? "");
        setPhone(person.phone ?? "");
        setEmail(person.email ?? "");
        setNotes(person.notes ?? "");
      } catch (err: any) {
        if (!active) return;
        setError(err?.message ?? "No se pudo cargar el inquilino.");
      } finally {
        if (active) setPageLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [user, loading, router, params.id, reloadToken]);

  const handleSubmit = async () => {
    if (!tenantId) return;
    if (!fullName.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updatePerson(tenantId, params.id, {
        fullName: fullName.trim(),
        dni: dni.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      router.replace("/tenants");
    } catch (err: any) {
      setError(err?.message ?? "No se pudo actualizar el inquilino.");
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
        <h1 className="text-2xl font-semibold text-zinc-900">Editar</h1>
        <p className="text-sm text-zinc-600">Actualiza la informacion.</p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {error && (
        <button
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
          className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Reintentar
        </button>
      )}
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Nombre completo
        </label>
        <input
          type="text"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">DNI</label>
        <input
          type="text"
          value={dni}
          onChange={(event) => setDni(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Telefono
        </label>
        <input
          type="text"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Notas
        </label>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="mt-2 min-h-[120px] w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !fullName.trim()}
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
          "Guardar cambios"
        )}
      </button>
    </section>
  );
}
