"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  User,
  onAuthStateChanged,
  signOut,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { getAuthClient } from "@/lib/firebase";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const auth = getAuthClient();

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      setError("Auth no disponible.");
      return;
    }
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        setUser(u);
        setLoading(false);
        setError(null);
      },
      (e) => {
        setError(e?.message ?? "Auth error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const logout = async () => {
    if (!auth) {
      setError("Auth no disponible.");
      return;
    }
    setError(null);
    await signOut(auth);
  };

  const loginWithGoogle = async () => {
    if (!auth) {
      setError("Auth no disponible.");
      return;
    }
    setError(null);
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const loginWithEmail = async (email: string, password: string) => {
    if (!auth) {
      setError("Auth no disponible.");
      return;
    }
    setError(null);
    await signInWithEmailAndPassword(auth, email, password);
  };

  const registerWithEmail = async (email: string, password: string) => {
    if (!auth) {
      setError("Auth no disponible.");
      return;
    }
    setError(null);
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, error, logout, loginWithGoogle, loginWithEmail, registerWithEmail }),
    [user, loading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within <AuthProvider />");
  return ctx;
}
