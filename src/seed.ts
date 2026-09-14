import { sha256 } from "@noble/hashes/sha2.js";
import { SAMPLE_SIZE } from "./rules";
const encoder = new TextEncoder();
export function validSeed(seed: unknown): seed is string { return typeof seed === "string" && /^[a-f0-9]{64}$/.test(seed); }
/** Shared counter-based stream. Rejection sampling avoids modulo bias. */
export function seededTicket(seed: string, index: number): number {
  if (!validSeed(seed) || !Number.isSafeInteger(index) || index < 0) throw new RangeError("Invalid roll sequence");
  const limit = Math.floor(0x100000000 / SAMPLE_SIZE) * SAMPLE_SIZE;
  for (let attempt = 0; ; attempt++) {
    const hash = sha256(encoder.encode(`pass-the-pigs:v1:${seed}:${index}:${attempt}`));
    const value = new DataView(hash.buffer, hash.byteOffset, hash.byteLength).getUint32(0, false);
    if (value < limit) return value % SAMPLE_SIZE;
  }
}
