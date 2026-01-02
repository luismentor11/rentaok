"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  const handleAuth = async (mode: "login" | "register") => {
    setSubmitting(true);
    setError(null);
    try {
      const auth = getAuthClient();
      if (!auth) {
        throw new Error("Auth no disponible.");
      }
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      router.replace("/");
    } catch (err: any) {
      setError(err?.message ?? "No se pudo autenticar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900">RentaOK</h1>
          <p className="text-sm text-zinc-600">Inicia sesion o crea tu cuenta.</p>
        </div>
        <label className="mb-2 block text-sm font-medium text-zinc-700">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mb-4 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
          placeholder="tu@email.com"
        />
        <label className="mb-2 block text-sm font-medium text-zinc-700">
          Contrasena
        </label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mb-4 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
          placeholder="******"
        />
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => handleAuth("login")}
            disabled={submitting || !email || !password}
            className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {submitting ? "Entrando..." : "Entrar"}
          </button>
          <button
            type="button"
            onClick={() => handleAuth("register")}
            disabled={submitting || !email || !password}
            className="w-full rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creando..." : "Crear cuenta"}
          </button>
        </div>
      </div>
    </main>
  );
}
