import {createHmac, randomBytes, timingSafeEqual} from "node:crypto";
import {PressError} from "../errors.js";

/**
 * RFC 6238 TOTP (and the RFC 4226 HOTP it builds on), implemented in-tree so the
 * admin second factor adds no third-party dependency / supply-chain surface for a
 * small, fully-specified algorithm. Defaults match every standard authenticator
 * app (Google Authenticator, Authy, 1Password): HMAC-SHA1, 30s step, 6 digits.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648, no padding
const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
/** Accept the adjacent steps too, tolerating ~±30s of client/server clock skew. */
const DEFAULT_WINDOW = 1;

export function base32Encode(buf: Buffer): string {
    let bits = 0;
    let value = 0;
    let out = "";
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
    return out;
}

export function base32Decode(input: string): Buffer {
    const clean = input.replace(/=+$/u, "").replace(/\s/gu, "").toUpperCase();
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of clean) {
        const idx = BASE32_ALPHABET.indexOf(ch);
        if (idx === -1) throw new PressError("validation", "Invalid base32 character in secret");
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

/** Generates a fresh base32 TOTP secret (default 160 bits, per RFC 6238 §5.1). */
export function generateTotpSecret(bytes = 20): string {
    return base32Encode(randomBytes(bytes));
}

function hotp(secret: Buffer, counter: number, digits: number): string {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", secret).update(msg).digest();
    // Dynamic truncation (RFC 4226 §5.3): low nibble of the last byte is the offset.
    const offset = digest.readUInt8(digest.length - 1) & 0x0f;
    const bin = digest.readUInt32BE(offset) & 0x7fffffff;
    return (bin % 10 ** digits).toString().padStart(digits, "0");
}

export interface TotpOptions {
    /** Epoch milliseconds; defaults to now. */
    time?: number;
    stepSeconds?: number;
    digits?: number;
}

export function totp(secretBase32: string, opts: TotpOptions = {}): string {
    const step = opts.stepSeconds ?? DEFAULT_STEP_SECONDS;
    const time = opts.time ?? Date.now();
    const counter = Math.floor(time / 1000 / step);
    return hotp(base32Decode(secretBase32), counter, opts.digits ?? DEFAULT_DIGITS);
}

function constantTimeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
}

/**
 * Verifies a user-entered code against the secret, scanning ±`window` steps so a
 * little clock skew still passes. Constant-time per-candidate compare.
 */
export function verifyTotp(
    secretBase32: string,
    code: string,
    opts: TotpOptions & { window?: number } = {},
): boolean {
    const normalized = String(code).replace(/\s/gu, "");
    const digits = opts.digits ?? DEFAULT_DIGITS;
    if (!new RegExp(`^\\d{${digits}}$`, "u").test(normalized)) return false;

    const step = opts.stepSeconds ?? DEFAULT_STEP_SECONDS;
    const time = opts.time ?? Date.now();
    const window = opts.window ?? DEFAULT_WINDOW;
    const secret = base32Decode(secretBase32);
    const counter = Math.floor(time / 1000 / step);
    for (let w = -window; w <= window; w++) {
        if (constantTimeEqual(hotp(secret, counter + w, digits), normalized)) return true;
    }
    return false;
}

/** Builds the `otpauth://` URI an authenticator app imports (manual entry or QR). */
export function otpauthUri(opts: { secret: string; account: string; issuer: string }): string {
    // Conventional label keeps the issuer:account colon literal; each part is escaped.
    const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
    const params = new URLSearchParams({
        secret: opts.secret,
        issuer: opts.issuer,
        algorithm: "SHA1",
        digits: String(DEFAULT_DIGITS),
        period: String(DEFAULT_STEP_SECONDS),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
}
