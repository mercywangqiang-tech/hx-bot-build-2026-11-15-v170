// HXBot: macOS keeps every secret in the key file, so the login Keychain never asks for its
// password (hx/rebrand.py `keychain`). These tests fail if any macOS path reaches `safeStorage`.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const touched: string[] = [];
  const touch =
    (name: string, value: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      touched.push(name);
      return value(...args);
    };
  return {
    touched,
    app: { isReady: () => true },
    safeStorage: {
      isEncryptionAvailable: touch("isEncryptionAvailable", () => true),
      encryptString: touch("encryptString", (value) => Buffer.from(`v10${String(value)}`)),
      decryptString: touch("decryptString", (value) => String(value).slice(3)),
      getSelectedStorageBackend: touch("getSelectedStorageBackend", () => "basic_text"),
    },
  };
});

vi.mock("electron", () => ({ app: electron.app, safeStorage: electron.safeStorage }));

const { createSecretStorage, SECRET_STORAGE_KEY_FILE } = await import("./secret-storage-cipher");

let folder: string;
const unavailable = () => "Secure storage is not available.";

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "hx-secret-storage-"));
  electron.touched.length = 0;
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("HXBot secret storage on macOS", () => {
  it("keeps secrets in its own key file and never calls safeStorage", () => {
    const keyPath = join(folder, "userData", SECRET_STORAGE_KEY_FILE);
    const storage = createSecretStorage({ keyPath, platform: "darwin" });
    const cipher = storage.cipher(unavailable);

    expect(cipher.canPersist()).toBe(true);
    const sealed = cipher.encrypt("session-token-🦒");
    expect(sealed.subarray(0, 4).toString("ascii")).toBe("obk1");
    expect(cipher.decrypt(sealed)).toBe("session-token-🦒");
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(keyPath, "utf8").trim()).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
    expect(electron.touched).toEqual([]);
  });

  it("reads a value from an earlier version as lost, without the Keychain", () => {
    const storage = createSecretStorage({ keyPath: join(folder, SECRET_STORAGE_KEY_FILE), platform: "darwin" });
    const cipher = storage.cipher(unavailable);
    expect(() => cipher.decrypt(Buffer.from("v10sealed-by-the-keychain"))).toThrow(
      "A secret sealed with the macOS Keychain is not read.",
    );
    expect(electron.touched).toEqual([]);
  });

  it("uses one key for every store and every start", () => {
    const keyPath = join(folder, SECRET_STORAGE_KEY_FILE);
    const first = createSecretStorage({ keyPath, platform: "darwin" }).cipher(unavailable);
    const sealed = first.encrypt("provider-key");
    const restarted = createSecretStorage({ keyPath, platform: "darwin" });
    expect(restarted.cipher(unavailable).decrypt(sealed)).toBe("provider-key");
    // The key was there already, so this start made no key file.
    expect(restarted.madeKeyFile()).toBe(false);
    expect(electron.touched).toEqual([]);
  });

  it("says that it made the key file, so the sign-in screen can explain the new sign-in", () => {
    const storage = createSecretStorage({ keyPath: join(folder, SECRET_STORAGE_KEY_FILE), platform: "darwin" });
    expect(storage.madeKeyFile()).toBe(false);
    storage.cipher(unavailable).canPersist();
    expect(storage.madeKeyFile()).toBe(true);
  });

  it("reports that it cannot persist when the key file cannot be made", () => {
    // A file where the folder should be: the key file cannot be made.
    const blocked = join(folder, "blocked");
    const storage = createSecretStorage({
      keyPath: join(blocked, "inside", SECRET_STORAGE_KEY_FILE),
      platform: "darwin",
    });
    writeFileSync(blocked, "not a folder");
    const cipher = storage.cipher(unavailable);
    expect(cipher.canPersist()).toBe(false);
    expect(() => cipher.encrypt("secret")).toThrow("Secure storage is not available.");
    expect(electron.touched).toEqual([]);
  });
});

describe("Windows keeps safeStorage", () => {
  it("encrypts with safeStorage and makes no key file", () => {
    const keyPath = join(folder, SECRET_STORAGE_KEY_FILE);
    const cipher = createSecretStorage({ keyPath, platform: "win32" }).cipher(unavailable);
    const sealed = cipher.encrypt("value");
    expect(sealed.toString()).toBe("v10value");
    expect(cipher.decrypt(sealed)).toBe("value");
    expect(electron.touched).toContain("encryptString");
    expect(() => statSync(keyPath)).toThrow();
  });
});
