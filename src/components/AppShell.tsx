"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 h-screen w-64 border-r border-border bg-surface px-5 py-6">
          <Link href="/dashboard" className="inline-flex items-center">
            <img
              src="/window.svg"
              alt="RentaOK"
              className="h-8 w-8"
            />
          </Link>
          <div className="mt-6 space-y-2 text-sm font-medium text-text-muted">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-surface-alt hover:text-text"
            >
              <span className="h-2 w-2 rounded-sm bg-muted" />
              Dashboard
            </Link>
            <Link
              href="/contracts"
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-surface-alt hover:text-text"
            >
              <span className="h-2 w-2 rounded-sm bg-muted" />
              Contratos
            </Link>
            <Link
              href="/payments"
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-surface-alt hover:text-text"
            >
              <span className="h-2 w-2 rounded-sm bg-muted" />
              Pagos
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-surface-alt hover:text-text"
            >
              <span className="h-2 w-2 rounded-sm bg-muted" />
              Configuracion
            </Link>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
            <div className="flex items-center justify-between px-6 py-4 text-sm text-text-muted">
              <span>Panel operativo</span>
              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-text-muted md:block">
                  {user?.email ?? ""}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-alt"
                >
                  Cerrar sesion
                </button>
              </div>
            </div>
          </header>
          <main className="flex-1 px-6 py-8 pb-28">{children}</main>
        </div>
      </div>
      <footer className="fixed bottom-0 left-0 right-0 border-t border-border bg-surface/95 px-6 py-3 text-xs text-text-muted backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-1">
          <div>RentaOK by Mentora®</div>
          <div>© 2025 Mentora. Todos los derechos reservados.</div>
          <div>
            RentaOK es una herramienta de gestión administrativa. No realiza
            cobranzas legales ni garantiza el pago. La información y los
            registros generados tienen fines operativos y documentales.
          </div>
        </div>
      </footer>
    </div>
  );
}
