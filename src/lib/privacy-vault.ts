import type { CompanionProfile } from "./types";

export type VaultRole = "primary" | "guardian";

export interface VaultEnvelope {
  schema: "humanity-companion.private-vault.v1";
  role: VaultRole;
  kdf: {
    name: "PBKDF2-SHA-256";
    iterations: 310_000;
    salt: string;
  };
  cipher: {
    name: "AES-256-GCM";
    iv: string;
    ciphertext: string;
  };
}

export interface VaultSession {
  readonly role: VaultRole;
  readonly key: CryptoKey;
  readonly salt: Uint8Array;
}

const SCHEMA = "humanity-companion.private-vault.v1" as const;
const ITERATIONS = 310_000 as const;
const PRIMARY_KEY = "humanity-companion-primary-vault-v1";
const GUARDIAN_KEY = "humanity-companion-guardian-vault-v1";
const MAX_PROFILE_BYTES = 4 * 1024 * 1024;

const storageKey = (role: VaultRole) => role === "primary" ? PRIMARY_KEY : GUARDIAN_KEY;

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string, maximumBytes: number): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("Private vault is unavailable.");
  const binary = atob(value);
  if (binary.length > maximumBytes) throw new Error("Private vault is unavailable.");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function passwordBytes(password: string): Uint8Array {
  if (password.length < 10 || password.length > 256 || /[\u0000-\u001f\u007f]/.test(password)) {
    throw new Error("Use a personal password of 10 to 256 characters.");
  }
  return new TextEncoder().encode(password.normalize("NFKC"));
}

function cryptoBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function additionalData(role: VaultRole): Uint8Array {
  return new TextEncoder().encode(`${SCHEMA}\u0000${role}`);
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", cryptoBytes(passwordBytes(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: cryptoBytes(salt), iterations: ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function validateEnvelope(value: unknown, expectedRole: VaultRole): VaultEnvelope {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Private vault is unavailable.");
  const envelope = value as Partial<VaultEnvelope>;
  if (!exactKeys(value, ["schema", "role", "kdf", "cipher"]) || envelope.schema !== SCHEMA || envelope.role !== expectedRole) throw new Error("Private vault is unavailable.");
  if (!envelope.kdf || typeof envelope.kdf !== "object" || Object.getPrototypeOf(envelope.kdf) !== Object.prototype || !exactKeys(envelope.kdf, ["name", "iterations", "salt"]) || envelope.kdf.name !== "PBKDF2-SHA-256" || envelope.kdf.iterations !== ITERATIONS || typeof envelope.kdf.salt !== "string") throw new Error("Private vault is unavailable.");
  if (!envelope.cipher || typeof envelope.cipher !== "object" || Object.getPrototypeOf(envelope.cipher) !== Object.prototype || !exactKeys(envelope.cipher, ["name", "iv", "ciphertext"]) || envelope.cipher.name !== "AES-256-GCM" || typeof envelope.cipher.iv !== "string" || typeof envelope.cipher.ciphertext !== "string") throw new Error("Private vault is unavailable.");
  fromBase64(envelope.kdf.salt, 16);
  fromBase64(envelope.cipher.iv, 12);
  fromBase64(envelope.cipher.ciphertext, MAX_PROFILE_BYTES + 64);
  return envelope as VaultEnvelope;
}

async function encryptWithSession(profile: CompanionProfile, session: VaultSession): Promise<VaultEnvelope> {
  const plaintext = new TextEncoder().encode(JSON.stringify(profile));
  if (plaintext.length > MAX_PROFILE_BYTES) throw new Error("The private profile is too large to lock safely.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: cryptoBytes(iv), additionalData: cryptoBytes(additionalData(session.role)) },
    session.key,
    cryptoBytes(plaintext),
  ));
  return {
    schema: SCHEMA,
    role: session.role,
    kdf: { name: "PBKDF2-SHA-256", iterations: ITERATIONS, salt: toBase64(session.salt) },
    cipher: { name: "AES-256-GCM", iv: toBase64(iv), ciphertext: toBase64(ciphertext) },
  };
}

export async function createVault(profile: CompanionProfile, password: string, role: VaultRole): Promise<{ envelope: VaultEnvelope; session: VaultSession }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const session = Object.freeze({ role, key: await deriveKey(password, salt), salt }) as VaultSession;
  return { envelope: await encryptWithSession(profile, session), session };
}

export async function openVault(envelopeValue: unknown, password: string, role: VaultRole): Promise<{ profile: CompanionProfile; session: VaultSession }> {
  const envelope = validateEnvelope(envelopeValue, role);
  const salt = fromBase64(envelope.kdf.salt, 16);
  const iv = fromBase64(envelope.cipher.iv, 12);
  const ciphertext = fromBase64(envelope.cipher.ciphertext, MAX_PROFILE_BYTES + 64);
  const key = await deriveKey(password, salt);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: cryptoBytes(iv), additionalData: cryptoBytes(additionalData(role)) },
      key,
      cryptoBytes(ciphertext),
    );
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    const profile = JSON.parse(decoded) as CompanionProfile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("invalid profile");
    return { profile, session: Object.freeze({ role, key, salt }) as VaultSession };
  } catch {
    throw new Error("The password was not accepted or the private vault is damaged.");
  }
}

export const resealVault = (profile: CompanionProfile, session: VaultSession) => encryptWithSession(profile, session);

export function saveVaultEnvelope(envelope: VaultEnvelope): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(storageKey(envelope.role), JSON.stringify(envelope));
}

export function loadVaultEnvelope(role: VaultRole): VaultEnvelope | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(storageKey(role));
  if (!raw) return null;
  try {
    return validateEnvelope(JSON.parse(raw), role);
  } catch {
    return null;
  }
}

export function hasVault(role: VaultRole): boolean {
  return loadVaultEnvelope(role) !== null;
}

export function removeVault(role: VaultRole): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey(role));
}
