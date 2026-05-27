import {describe, expect, it} from "vitest";
import {
    base32Decode,
    base32Encode,
    generateTotpSecret,
    otpauthUri,
    totp,
    verifyTotp,
} from "./totp.js";

// RFC 6238 Appendix B reference secret for SHA1: the ASCII string
// "12345678901234567890" (20 bytes).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32", () => {
    it("encodes the RFC reference secret without padding", () => {
        expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    });
    it("round-trips arbitrary bytes", () => {
        const buf = Buffer.from([0, 1, 2, 250, 255, 128, 64, 33]);
        expect(base32Decode(base32Encode(buf))).toEqual(buf);
    });
    it("rejects an invalid character", () => {
        expect(() => base32Decode("0189!")).toThrowError();
    });
});

describe("totp — RFC 6238 vectors (SHA1, 8 digits)", () => {
    // From RFC 6238 Appendix B (SHA1 column).
    const vectors: { time: number; code: string }[] = [
        {time: 59, code: "94287082"},
        {time: 1111111109, code: "07081804"},
        {time: 1111111111, code: "14050471"},
        {time: 1234567890, code: "89005924"},
        {time: 2000000000, code: "69279037"},
        {time: 20000000000, code: "65353130"},
    ];
    for (const v of vectors) {
        it(`T=${v.time}s → ${v.code}`, () => {
            expect(totp(RFC_SECRET, {time: v.time * 1000, digits: 8})).toBe(v.code);
        });
    }
});

describe("verifyTotp", () => {
    it("accepts the current 6-digit code", () => {
        const now = Date.now();
        const code = totp(RFC_SECRET, {time: now});
        expect(verifyTotp(RFC_SECRET, code, {time: now})).toBe(true);
    });

    it("accepts a code from the previous step (clock skew)", () => {
        const now = Date.now();
        const prev = totp(RFC_SECRET, {time: now - 30_000});
        expect(verifyTotp(RFC_SECRET, prev, {time: now})).toBe(true);
    });

    it("rejects a code two steps away (outside the window)", () => {
        const now = Date.now();
        const old = totp(RFC_SECRET, {time: now - 90_000});
        expect(verifyTotp(RFC_SECRET, old, {time: now})).toBe(false);
    });

    it("rejects malformed input", () => {
        expect(verifyTotp(RFC_SECRET, "abc", {})).toBe(false);
        expect(verifyTotp(RFC_SECRET, "12345", {})).toBe(false); // wrong length
        expect(verifyTotp(RFC_SECRET, "", {})).toBe(false);
    });

    it("tolerates spaces in user input", () => {
        const now = Date.now();
        const code = totp(RFC_SECRET, {time: now});
        const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
        expect(verifyTotp(RFC_SECRET, spaced, {time: now})).toBe(true);
    });
});

describe("secrets + uri", () => {
    it("generates a decodable 160-bit secret", () => {
        const s = generateTotpSecret();
        expect(base32Decode(s)).toHaveLength(20);
    });
    it("builds an otpauth URI with issuer + account", () => {
        const uri = otpauthUri({secret: "ABC234", account: "a@b.com", issuer: "Pressh"});
        expect(uri.startsWith("otpauth://totp/Pressh:a%40b.com?")).toBe(true);
        expect(uri).toContain("secret=ABC234");
        expect(uri).toContain("issuer=Pressh");
        expect(uri).toContain("algorithm=SHA1");
    });
});
