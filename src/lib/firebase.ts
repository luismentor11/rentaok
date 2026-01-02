"use client";

import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { initializeFirestore, serverTimestamp } from "firebase/firestore";

type FirebaseWebAppConfig = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

const envConfig: FirebaseWebAppConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const getFirebaseConfig = (): FirebaseWebAppConfig => {
  if (envConfig.apiKey) {
    return envConfig;
  }

  const rawConfig = process.env.FIREBASE_WEBAPP_CONFIG;
  if (!rawConfig) {
    return envConfig;
  }

  try {
    const parsed = JSON.parse(rawConfig) as FirebaseWebAppConfig;
    return {
      apiKey: parsed.apiKey,
      authDomain: parsed.authDomain,
      projectId: parsed.projectId,
      storageBucket: parsed.storageBucket,
      messagingSenderId: parsed.messagingSenderId,
      appId: parsed.appId,
    };
  } catch {
    return envConfig;
  }
};

const firebaseConfig = getFirebaseConfig();
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

let authClient: ReturnType<typeof getAuth> | null = null;

export const getAuthClient = () => {
  if (typeof window === "undefined") {
    return null;
  }
  if (!authClient) {
    authClient = getAuth(app);
  }
  return authClient;
};

export const auth = getAuthClient();
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});
export const storage = getStorage(app);
export { serverTimestamp };
