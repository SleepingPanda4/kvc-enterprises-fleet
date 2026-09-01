import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedCredential = { ciphertext: string; iv: string; tag: string; version: "aes-256-gcm-v1" };

function masterKey(value = process.env.KVC_CREDENTIAL_MASTER_KEY) {
  if (!value) throw new Error("Integration credential encryption is not configured.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) throw new Error("Integration credential encryption key is invalid.");
  return key;
}

export function encryptIntegrationPassword(value: string, keyValue?: string): EncryptedCredential {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", masterKey(keyValue), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), version: "aes-256-gcm-v1" };
}

export function decryptIntegrationPassword(value: EncryptedCredential, keyValue?: string) {
  try {
    if (value.version !== "aes-256-gcm-v1") throw new Error("Unsupported credential encryption version.");
    const decipher = createDecipheriv("aes-256-gcm", masterKey(keyValue), Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch { throw new Error("Integration credential could not be decrypted."); }
}
