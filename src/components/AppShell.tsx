"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="text-lg font-semibold text-zinc-900">RentaOK</div>
          <div className="flex items-center gap-4 text-sm text-zinc-600">
            <span>{user?.email ?? ""}</span>
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Cerrar sesion
            </button>
          </div>
        </div>
      </header>
      <nav className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl gap-4 px-4 py-3 text-sm font-medium text-zinc-700">
          <Link href="/" className="hover:text-zinc-900">
            Dashboard
          </Link>
          <Link href="/properties" className="hover:text-zinc-900">
            Propiedades
          </Link>
          <Link href="/tenants" className="hover:text-zinc-900">
            Inquilinos
          </Link>
          <Link href="/settings" className="hover:text-zinc-900">
            Configuracion
          </Link>
        </div>
      </nav>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
