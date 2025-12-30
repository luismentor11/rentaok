"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, serverTimestamp } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";

type PingData = {
  updatedAt?: unknown;
  byUid?: string;
  [key: string]: unknown;
};

export default function FirestoreDebugPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<string>("Idle");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PingData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  const writePing = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await setDoc(doc(db, "debug_pings", "ping"), {
        updatedAt: serverTimestamp(),
        byUid: user.uid,
      });
      setStatus("Ping escrito");
    } catch (err: any) {
      setError(err?.message ?? "Error escribiendo ping.");
    } finally {
      setBusy(false);
    }
  };

  const readPing = async () => {
    setBusy(true);
    setError(null);
    try {
      const snap = await getDoc(doc(db, "debug_pings", "ping"));
      setData(snap.exists() ? (snap.data() as PingData) : null);
      setStatus(snap.exists() ? "Ping leido" : "Ping no existe");
    } catch (err: any) {
      setError(err?.message ?? "Error leyendo ping.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-zinc-600">Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          Firestore Debug
        </h1>
        <p className="text-sm text-zinc-600">
          Estado: {status} | Usuario: {user.email ?? "sin email"}
        </p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={writePing}
          disabled={busy}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          Escribir ping
        </button>
        <button
          type="button"
          onClick={readPing}
          disabled={busy}
          className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
        >
          Leer ping
        </button>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
        <pre className="whitespace-pre-wrap">
          {data ? JSON.stringify(data, null, 2) : "Sin datos"}
        </pre>
      </div>
    </section>
  );
}
