"use client";

import Link from "next/link";

export default function PaymentsPage() {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-zinc-900">Pagos</h1>
        <p className="text-sm text-zinc-600">
          Vista global de vencidos / por vencer / parciales
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
        <div>Vista global (proximamente datos).</div>
        <Link
          href="/contracts"
          className="mt-3 inline-flex rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Ir a contratos
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs font-semibold text-zinc-500">Hoy</div>
          <div className="mt-3 text-sm text-zinc-600">Placeholder</div>
          <Link
            href="#"
            className="mt-3 inline-flex text-sm font-medium text-zinc-800 hover:text-zinc-600"
          >
            Ver contrato
          </Link>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs font-semibold text-zinc-500">Vencidos</div>
          <div className="mt-3 text-sm text-zinc-600">Placeholder</div>
          <Link
            href="#"
            className="mt-3 inline-flex text-sm font-medium text-zinc-800 hover:text-zinc-600"
          >
            Ver contrato
          </Link>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="text-xs font-semibold text-zinc-500">Parciales</div>
          <div className="mt-3 text-sm text-zinc-600">Placeholder</div>
          <Link
            href="#"
            className="mt-3 inline-flex text-sm font-medium text-zinc-800 hover:text-zinc-600"
          >
            Ver contrato
          </Link>
        </div>
      </div>
    </section>
  );
}
