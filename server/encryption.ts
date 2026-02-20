import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const PREFIX_V1 = "enc:v1:";
const PREFIX_V2 = "enc:v2:";

let encryptionKey: Buffer | null = null;
let encryptionEnabled = false;

/**
 * Initializes the encryption key from the ENCRYPTION_KEY environment variable.
 * Must be called before any encrypt/decrypt operations.
 *
 * In production (NODE_ENV=production), throws if the key is missing.
 * In development, logs a warning and falls back to plaintext pass-through
 * so the app can run without configuring the secret.
 */
export function initEncryption(): void {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENCRYPTION_KEY environment variable is required in production. " +
        "Set it to any strong secret string (min 16 characters recommended)."
      );
    }
    console.warn(
      "[encryption] ENCRYPTION_KEY not set — encryption disabled. " +
      "Data will be stored in plaintext. Set ENCRYPTION_KEY for encrypted storage."
    );
    encryptionEnabled = false;
    return;
  }
  // Derive a 256-bit key from the secret using SHA-256
  encryptionKey = crypto.createHash("sha256").update(raw).digest();
  encryptionEnabled = true;
}

/** Returns true if encryption is active (key was provided). */
export function isEncryptionEnabled(): boolean {
  return encryptionEnabled;
}

function getKey(): Buffer {
  if (!encryptionKey) {
    throw new Error("Encryption not initialized. Call initEncryption() first.");
  }
  return encryptionKey;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * When `aad` is provided (typically the userId for user-scoped data),
 * the value is cryptographically bound to that context using GCM's
 * Associated Authenticated Data. This means the ciphertext can only be
 * decrypted with the same AAD — if a row is moved to a different user
 * at the DB level, decryption will fail with an auth tag mismatch.
 *
 * Format: enc:v2:<aad_hex>:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * (or enc:v1:... when no AAD is provided, for backward compat)
 *
 * Returns null if input is null/undefined.
 */
export function encrypt(plaintext: string | null | undefined, aad?: string | null): string | null {
  if (plaintext === null || plaintext === undefined) {
    return null;
  }

  // When no key is configured, store plaintext (development mode)
  if (!encryptionEnabled) {
    return plaintext;
  }

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const aadBuf = aad ? Buffer.from(aad, "utf8") : null;
  if (aadBuf) {
    cipher.setAAD(aadBuf);
  }

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  if (aadBuf) {
    return `${PREFIX_V2}${aadBuf.toString("hex")}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  }
  return `${PREFIX_V1}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts an encrypted string produced by encrypt().
 *
 * For v2 ciphertext the embedded AAD is used automatically during
 * verification. If `expectedAad` is provided and differs from the
 * embedded AAD, an error is thrown (prevents cross-user data access).
 *
 * If the input doesn't have an enc: prefix, returns it as-is
 * (supports reading pre-encryption plaintext data).
 *
 * Returns null if input is null/undefined.
 */
export function decrypt(ciphertext: string | null | undefined, expectedAad?: string | null): string | null {
  if (ciphertext === null || ciphertext === undefined) {
    return null;
  }

  // Pass through plaintext that was stored before encryption was enabled,
  // or when encryption is disabled in development
  if (!ciphertext.startsWith("enc:")) {
    return ciphertext;
  }

  // If data is encrypted but we have no key, we can't decrypt — this
  // shouldn't happen in normal operation (means key was removed after data
  // was encrypted). Throw a clear error rather than silently corrupting.
  if (!encryptionEnabled) {
    throw new Error(
      "Cannot decrypt data: ENCRYPTION_KEY is not set but encrypted data was found. " +
      "Set ENCRYPTION_KEY to the same value used when the data was encrypted."
    );
  }

  const key = getKey();

  if (ciphertext.startsWith(PREFIX_V2)) {
    // v2 format: enc:v2:<aad_hex>:<iv_hex>:<authTag_hex>:<ciphertext_hex>
    const parts = ciphertext.slice(PREFIX_V2.length).split(":");
    if (parts.length !== 4) {
      throw new Error("Invalid v2 encrypted data format");
    }

    const [aadHex, ivHex, authTagHex, encryptedHex] = parts;
    const aadBuf = Buffer.from(aadHex, "hex");

    // Verify AAD matches expected context if provided
    if (expectedAad && aadBuf.toString("utf8") !== expectedAad) {
      throw new Error("AAD mismatch: encrypted data does not belong to the expected user context");
    }

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(aadBuf);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // v1 format: enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
  const parts = ciphertext.slice(PREFIX_V1.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid v1 encrypted data format");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Encrypts a JSONB value by serializing to JSON, encrypting, and returning the encrypted string.
 */
export function encryptJson(value: unknown, aad?: string | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return encrypt(JSON.stringify(value), aad);
}

/**
 * Decrypts a JSONB value. If encrypted, decrypts and parses JSON.
 * If not encrypted (legacy data), returns as-is.
 */
export function decryptJson<T>(value: unknown, expectedAad?: string | null): T | null {
  if (value === null || value === undefined) {
    return null;
  }

  // If the value is a string that starts with our prefix, it's encrypted
  if (typeof value === "string" && value.startsWith("enc:")) {
    const decrypted = decrypt(value, expectedAad);
    return decrypted ? JSON.parse(decrypted) as T : null;
  }

  // Already a parsed object (legacy unencrypted JSONB)
  return value as T;
}
