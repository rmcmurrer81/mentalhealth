import { beforeEach, describe, expect, it } from "vitest";
import { defaultProfile } from "../src/lib/memory";
import { createVault, openVault } from "../src/lib/privacy-vault";

describe("optional encrypted private vault", () => {
  beforeEach(() => {
    if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required for this test.");
  });

  it("round-trips a private profile without putting its text in the envelope", async () => {
    const profile = { ...defaultProfile(), preferredName: "Riley" };
    const { envelope } = await createVault(profile, "correct horse battery", "primary");
    expect(JSON.stringify(envelope)).not.toContain("Riley");
    const opened = await openVault(envelope, "correct horse battery", "primary");
    expect(opened.profile.preferredName).toBe("Riley");
  });

  it("fails closed for a wrong password or ciphertext modification", async () => {
    const { envelope } = await createVault(defaultProfile(), "correct horse battery", "primary");
    await expect(openVault(envelope, "wrong password value", "primary")).rejects.toThrow(/not accepted|damaged/);
    const tampered = structuredClone(envelope);
    tampered.cipher.ciphertext = `${tampered.cipher.ciphertext.slice(0, -4)}AAAA`;
    await expect(openVault(tampered, "correct horse battery", "primary")).rejects.toThrow(/not accepted|damaged/);
  });

  it("cryptographically separates guardian and primary roles", async () => {
    const { envelope } = await createVault(defaultProfile(), "same strong password", "primary");
    const relabeled = structuredClone(envelope);
    relabeled.role = "guardian";
    await expect(openVault(relabeled, "same strong password", "guardian")).rejects.toThrow(/not accepted|damaged/);
  });

  it("rejects weak or control-bearing passwords", async () => {
    await expect(createVault(defaultProfile(), "short", "primary")).rejects.toThrow(/10 to 256/);
    await expect(createVault(defaultProfile(), "long enough\npassword", "primary")).rejects.toThrow(/10 to 256/);
  });
});
