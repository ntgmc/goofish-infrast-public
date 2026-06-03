const OBFUSCATE_KEY_SEED = "maa-obfuscate-v1";
const CLIENT_STATE_SALT = "client-state-v1";

function enc(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getObfuscateKey(): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", enc(OBFUSCATE_KEY_SEED));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function decryptPayload(base64Data: string): Promise<string> {
  const raw = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const ciphertext = raw.slice(12);
  const key = await getObfuscateKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

export async function encryptPayload(jsonStr: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getObfuscateKey();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc(jsonStr)
  );
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function hmacSha256(
  key: string | CryptoKey,
  data: string
): Promise<string> {
  let cryptoKey: CryptoKey;
  if (typeof key === "string") {
    cryptoKey = await crypto.subtle.importKey(
      "raw",
      enc(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } else {
    cryptoKey = key;
  }
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc(data));
  return bufToHex(sig);
}

export async function verifyHmacSha256(
  key: string,
  data: string,
  expectedHex: string
): Promise<boolean> {
  const actual = await hmacSha256(key, data);
  return actual === expectedHex;
}

export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map(
    (k) => JSON.stringify(k) + ":" + canonicalJson((obj as Record<string, unknown>)[k])
  );
  return "{" + pairs.join(",") + "}";
}

export async function deriveClientKey(licenseSig: string): Promise<string> {
  return hmacSha256(licenseSig, CLIENT_STATE_SALT);
}

export async function signClientState(
  derivedKey: string,
  eliteOverrides: Record<string, number>
): Promise<string> {
  const payload = canonicalJson({ operator_elite_overrides: eliteOverrides });
  return hmacSha256(derivedKey, payload);
}

export async function verifyClientState(
  derivedKey: string,
  eliteOverrides: Record<string, number>,
  expectedSig: string
): Promise<boolean> {
  const actual = await signClientState(derivedKey, eliteOverrides);
  return actual === expectedSig;
}

