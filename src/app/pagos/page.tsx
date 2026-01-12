"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

export default function PagosPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-2 text-sm text-zinc-600">
        Cargando...
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold text-zinc-900">Pagos</h1>
      <p className="text-sm text-zinc-600">
        Pagos (próximo paquete: movimientos)
      </p>
    </section>
  );
}
