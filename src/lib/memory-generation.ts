export interface MemoryGenerationResolution<T> {
  value: T;
  refreshed: boolean;
}

export type ProfileGenerationResolution<T> =
  | { status: "resolved"; value: T; refreshed: boolean }
  | { status: "discarded"; reason: "privacy-session-changed" };

export function nextMemoryGeneration(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || current === Number.MAX_SAFE_INTEGER) return 1;
  return current + 1;
}

export async function resolveWithMemoryGeneration<T>(
  capturedGeneration: number,
  currentGeneration: () => number,
  pending: () => Promise<T>,
  refresh: () => T,
): Promise<MemoryGenerationResolution<T>> {
  if (currentGeneration() !== capturedGeneration) {
    return { value: refresh(), refreshed: true };
  }
  const value = await pending();
  if (currentGeneration() !== capturedGeneration) {
    return { value: refresh(), refreshed: true };
  }
  return { value, refreshed: false };
}

export async function resolveWithProfileGenerations<T>(
  capturedPrivacySessionGeneration: number,
  currentPrivacySessionGeneration: () => number,
  capturedMemoryGeneration: number,
  currentMemoryGeneration: () => number,
  pending: () => Promise<T>,
  refreshAfterForget: () => T,
): Promise<ProfileGenerationResolution<T>> {
  if (currentPrivacySessionGeneration() !== capturedPrivacySessionGeneration) {
    return { status: "discarded", reason: "privacy-session-changed" };
  }
  if (currentMemoryGeneration() !== capturedMemoryGeneration) {
    return { status: "resolved", value: refreshAfterForget(), refreshed: true };
  }
  const value = await pending();
  if (currentPrivacySessionGeneration() !== capturedPrivacySessionGeneration) {
    return { status: "discarded", reason: "privacy-session-changed" };
  }
  if (currentMemoryGeneration() !== capturedMemoryGeneration) {
    return { status: "resolved", value: refreshAfterForget(), refreshed: true };
  }
  return { status: "resolved", value, refreshed: false };
}
