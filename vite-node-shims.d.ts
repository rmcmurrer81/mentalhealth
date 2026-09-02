declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
}

declare module "node:url" {
  export function fileURLToPath(url: URL): string;
}

declare module "node:crypto" {
  type HashInput = string | Uint8Array;
  interface Hash {
    update(data: HashInput): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: "sha256"): Hash;
}
