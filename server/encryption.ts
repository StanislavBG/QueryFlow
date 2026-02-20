import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PREFIX = "enc:v1:";

let encryptionKey: Buffer | null = null;

/**
 * Initializes the encryption key from the ENCRYPTION_KEY environment variable.
 * Must be called before any encrypt/decrypt operations.
 * The env var can be any string; it will be hashed to derive a 256-bit key.
 */
export function initEncryption(): void {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length === 0) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required. " +
      "Set it to any strong secret string (min 16 characters recommended)."
    );
  }
  // Derive a 256-bit key from the secret using SHA-256
  encryptionKey = crypto.createHash("sha256").update(raw).digest();
}

function getKey(): Buffer {
  if (!encryptionKey) {
    throw new Error("Encryption not initialized. Call initEncryption() first.");
  }
  return encryptionKey;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a prefixed string: enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * Returns null if input is null/undefined.
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) {
    return null;
  }

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts an encrypted string produced by encrypt().
 * If the input doesn't have the enc:v1: prefix, returns it as-is
 * (supports reading pre-encryption plaintext data).
 * Returns null if input is null/undefined.
 */
export function decrypt(ciphertext: string | null | undefined): string | null {
  if (ciphertext === null || ciphertext === undefined) {
    return null;
  }

  // Pass through plaintext that was stored before encryption was enabled
  if (!ciphertext.startsWith(PREFIX)) {
    return ciphertext;
  }

  const key = getKey();
  const parts = ciphertext.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
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
 * The database column stores the encrypted string as a JSON string value.
 */
export function encryptJson(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return encrypt(JSON.stringify(value));
}

/**
 * Decrypts a JSONB value. If encrypted, decrypts and parses JSON.
 * If not encrypted (legacy data), returns as-is.
 */
export function decryptJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) {
    return null;
  }

  // If the value is a string that starts with our prefix, it's encrypted
  if (typeof value === "string" && value.startsWith(PREFIX)) {
    const decrypted = decrypt(value);
    return decrypted ? JSON.parse(decrypted) as T : null;
  }

  // Already a parsed object (legacy unencrypted JSONB)
  return value as T;
}
