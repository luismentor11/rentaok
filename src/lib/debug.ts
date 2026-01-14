export type DebugErrorEntry = {
  at: string;
  scope: string;
  message: string;
  code?: string;
  details?: string;
};

const STORAGE_KEY = "rentaok:debug:lastError";
const AI_STORAGE_KEY = "rentaok:debug:lastAiError";

const getErrorInfo = (err: unknown) => {
  if (!err || typeof err !== "object") {
    return { message: String(err ?? "Unknown error") };
  }
  const anyErr = err as { code?: unknown; message?: unknown; stack?: unknown };
  const code = anyErr.code ? String(anyErr.code) : undefined;
  const message = anyErr.message ? String(anyErr.message) : "Unknown error";
  const details =
    anyErr.stack && typeof anyErr.stack === "string"
      ? anyErr.stack
      : undefined;
  return { code, message, details };
};

export const recordDebugError = (scope: string, err: unknown) => {
  if (typeof window === "undefined") return;
  const info = getErrorInfo(err);
  const entry: DebugErrorEntry = {
    at: new Date().toISOString(),
    scope,
    message: info.message,
    ...(info.code ? { code: info.code } : {}),
    ...(info.details ? { details: info.details } : {}),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // ignore storage errors
  }
};

export const readDebugError = (): DebugErrorEntry | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DebugErrorEntry;
  } catch {
    return null;
  }
};

export const recordAiError = (scope: string, err: unknown) => {
  if (typeof window === "undefined") return;
  const info = getErrorInfo(err);
  const entry: DebugErrorEntry = {
    at: new Date().toISOString(),
    scope,
    message: info.message,
    ...(info.code ? { code: info.code } : {}),
    ...(info.details ? { details: info.details } : {}),
  };
  try {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // ignore storage errors
  }
};

export const readAiError = (): DebugErrorEntry | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DebugErrorEntry;
  } catch {
    return null;
  }
};
