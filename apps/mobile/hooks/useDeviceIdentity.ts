import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPublicKey, sign, hashes as edHashes } from "@noble/ed25519";
import { sha512, sha256 } from "@noble/hashes/sha2.js";

// Configure @noble/ed25519 to use @noble/hashes for SHA-512 (Hermes has no crypto.subtle)
const concatMessages = (messages: Uint8Array[]): Uint8Array => {
  const totalLen = messages.reduce((sum, m) => sum + m.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const m of messages) {
    combined.set(m, offset);
    offset += m.length;
  }
  return combined;
};
edHashes.sha512Async = async (...messages: Uint8Array[]): Promise<Uint8Array> => {
  return sha512(concatMessages(messages));
};
edHashes.sha512 = (...messages: Uint8Array[]): Uint8Array => {
  return sha512(concatMessages(messages));
};

const STORAGE_KEY = "openclaw-device-identity-v1";

export interface DeviceIdentity {
  version: number;
  deviceId: string; // SHA-256 hex of public key
  publicKey: string; // base64url of 32-byte raw public key
  privateKey: string; // base64url of 32-byte raw private key
  createdAtMs: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sha256Hex(data: Uint8Array): string {
  const hash = sha256(data);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function generateIdentity(): Promise<DeviceIdentity> {
  // Generate random 32-byte private key
  const privateKeyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) privateKeyBytes[i] = Math.floor(Math.random() * 256);

  const publicKeyBytes = await getPublicKey(privateKeyBytes);
  const deviceId = await sha256Hex(publicKeyBytes);

  return {
    version: 1,
    deviceId,
    publicKey: base64UrlEncode(publicKeyBytes),
    privateKey: base64UrlEncode(privateKeyBytes),
    createdAtMs: Date.now(),
  };
}

export async function loadOrCreateIdentity(): Promise<DeviceIdentity> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as DeviceIdentity;
      if (parsed.version === 1 && parsed.deviceId && parsed.publicKey && parsed.privateKey) {
        return parsed;
      }
    } catch {
      // Corrupted — regenerate
    }
  }
  const identity = await generateIdentity();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export async function signPayload(
  privateKeyB64: string,
  message: string
): Promise<string> {
  const privateKeyBytes = base64UrlDecode(privateKeyB64);
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = await sign(messageBytes, privateKeyBytes);
  return base64UrlEncode(signatureBytes);
}

export function useDeviceIdentity() {
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    loadOrCreateIdentity()
      .then(setIdentity)
      .catch((err) => console.error("[DeviceIdentity] Failed to load:", err));
  }, []);

  return identity;
}
