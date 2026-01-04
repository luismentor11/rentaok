export function toDateSafe(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date ? date : null;
  }
  return null;
}
