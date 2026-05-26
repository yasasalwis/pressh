import {createHash, randomBytes, randomUUID} from "node:crypto";
import {PressError} from "./errors.js";
import type {Result} from "./result.js";
import type {AuditLog} from "./audit.js";
import type {StorageAdapter, StoredDoc} from "./storage/types.js";
import {hashPassword, verifyPassword} from "./auth/password.js";

const MEMBER_ACCOUNTS = "member_accounts";
const MEMBER_SESSIONS = "member_sessions";
const MEMBER_TOKENS = "member_tokens";

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOCKOUT_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_DISPLAY_NAME_LENGTH = 60;
const MAX_BIO_LENGTH = 500;

type TokenType = "email_verify" | "magic_link" | "pw_reset";

interface MemberAccountRecord extends StoredDoc {
    email: string;
    passwordHash: string | null;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    emailVerified: boolean;
    status: "active" | "suspended";
    failedAttempts: number;
    lockedUntil: number | null;
    createdAt: string;
    updatedAt: string;
}

interface MemberSessionRecord extends StoredDoc {
    memberId: string;
    expiresAt: number;
    createdAt: string;
}

interface MemberTokenRecord extends StoredDoc {
    memberId: string;
    email: string;
    type: TokenType;
    tokenHash: string;
    expiresAt: number;
    usedAt: string | null;
    createdAt: string;
}

/** Public view of a site member — no password hash, no lockout state. */
export interface Member {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    emailVerified: boolean;
    status: "active" | "suspended";
    createdAt: string;
    updatedAt: string;
}

export interface MemberLoginResult {
    /** Raw session token — the caller must set this as a cookie; never log it. */
    token: string;
    member: Member;
}

export interface MemberAuthServiceOptions {
    storage: StorageAdapter;
    audit: AuditLog;
    now?: () => number;
    maxFailedAttempts?: number;
    lockoutMs?: number;
}

export interface MemberAuthService {
    /**
     * Register a new member. Returns the created member and a one-time
     * `verifyToken` (raw) to include in the verification email.
     */
    register(input: {
        email: string;
        password: string;
        displayName: string;
    }): Promise<{ member: Member; verifyToken: string }>;

    /** Consume an email-verify token; marks the member as verified. */
    verifyEmail(input: { token: string }): Promise<Member>;

    /**
     * Password login. Requires email to be verified.
     * Implements account lockout with exponential backoff.
     */
    authenticate(input: { email: string; password: string }): Promise<MemberLoginResult>;

    /** Validate a session token; returns the member or null if invalid/expired. */
    validateSession(token: string): Promise<Member | null>;

    /** Revoke a session (logout). */
    logout(token: string): Promise<void>;

    /**
     * Create a magic-link token for `memberId`.
     * Caller is responsible for anti-enumeration (look up by email first, only
     * call this when the member exists, always return 200 regardless).
     */
    issueMagicToken(memberId: string): Promise<string>;

    /**
     * Verify a magic-link token and create a session.
     * Sets `emailVerified = true` as a side-effect (clicking the link proves inbox ownership).
     */
    verifyMagicLink(input: { token: string }): Promise<MemberLoginResult>;

    /**
     * Create a password-reset token for `memberId`.
     * Caller is responsible for anti-enumeration.
     */
    issuePasswordResetToken(memberId: string): Promise<string>;

    /** Consume a reset token and replace the member's password. */
    confirmPasswordReset(input: { token: string; newPassword: string }): Promise<Member>;

    getMember(id: string): Promise<Member | null>;

    getMemberByEmail(email: string): Promise<Member | null>;

    updateProfile(
        memberId: string,
        input: { displayName?: string; bio?: string },
    ): Promise<Member>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function must<T>(result: Result<T>): T {
    if (!result.ok) throw result.error;
    return result.value;
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

/** Store tokens as their SHA-256 hash so a db leak doesn't expose usable tokens. */
function tokenHash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
}

function toPublic(r: MemberAccountRecord): Member {
    return {
        id: r.id,
        email: r.email,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        bio: r.bio,
        emailVerified: r.emailVerified,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class MemberAuthServiceImpl implements MemberAuthService {
    readonly #storage: StorageAdapter;
    readonly #audit: AuditLog;
    readonly #now: () => number;
    readonly #maxAttempts: number;
    readonly #lockoutMs: number;
    readonly #dummyHash: string;

    constructor(opts: MemberAuthServiceOptions, dummyHash: string) {
        this.#storage = opts.storage;
        this.#audit = opts.audit;
        this.#now = opts.now ?? (() => Date.now());
        this.#maxAttempts = opts.maxFailedAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.#lockoutMs = opts.lockoutMs ?? DEFAULT_LOCKOUT_MS;
        this.#dummyHash = dummyHash;
    }

    async register(input: {
        email: string;
        password: string;
        displayName: string;
    }): Promise<{ member: Member; verifyToken: string }> {
        const email = normalizeEmail(input.email);
        if (!email.includes("@")) throw new PressError("validation", "A valid email is required");
        if (input.password.length < MIN_PASSWORD_LENGTH) {
            throw new PressError("validation", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        }
        const name = input.displayName.trim();
        if (!name) throw new PressError("validation", "Display name is required");
        if (name.length > MAX_DISPLAY_NAME_LENGTH) {
            throw new PressError("validation", `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`);
        }
        if (await this.#findByEmail(email)) {
            throw new PressError("conflict", "An account with this email already exists");
        }

        const now = this.#now();
        const record: MemberAccountRecord = {
            id: randomUUID(),
            email,
            passwordHash: await hashPassword(input.password),
            displayName: name,
            avatarUrl: null,
            bio: null,
            emailVerified: false,
            status: "active",
            failedAttempts: 0,
            lockedUntil: null,
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
        };
        must(await this.#storage.put(MEMBER_ACCOUNTS, record));
        await this.#audit.append({
            action: "member.register",
            actorId: record.id,
            detail: {email},
        });

        const verifyToken = await this.#issueToken(record.id, email, "email_verify", VERIFY_TOKEN_TTL_MS);
        return {member: toPublic(record), verifyToken};
    }

    async verifyEmail(input: { token: string }): Promise<Member> {
        const tokenRecord = await this.#consumeToken(input.token, "email_verify");
        const member = must(
            await this.#storage.get<MemberAccountRecord>(MEMBER_ACCOUNTS, tokenRecord.memberId),
        );
        if (!member) throw new PressError("not_found", "Member not found");
        member.emailVerified = true;
        member.updatedAt = new Date(this.#now()).toISOString();
        must(await this.#storage.put(MEMBER_ACCOUNTS, member));
        await this.#audit.append({
            action: "member.email.verified",
            actorId: member.id,
            detail: {email: member.email},
        });
        return toPublic(member);
    }

    async authenticate(input: { email: string; password: string }): Promise<MemberLoginResult> {
        const email = normalizeEmail(input.email);
        const record = await this.#findByEmail(email);
        const t = this.#now();
        const locked = record !== null && record.lockedUntil !== null && record.lockedUntil > t;

        // Always verify against something — prevents timing-based account enumeration.
        const hashToCheck = record?.passwordHash ?? this.#dummyHash;
        const passwordOk = await verifyPassword(hashToCheck, input.password);

        if (locked) {
            await this.#audit.append({
                action: "member.login.locked",
                actorId: record.id,
                detail: {email},
            });
            throw new PressError("unauthorized", "Invalid credentials");
        }

        if (!record || !passwordOk || record.status === "suspended") {
            if (record && record.status !== "suspended") {
                record.failedAttempts += 1;
                if (record.failedAttempts >= this.#maxAttempts) {
                    const tier = Math.floor(record.failedAttempts / this.#maxAttempts);
                    const backoff = Math.min(this.#lockoutMs * 2 ** (tier - 1), MAX_LOCKOUT_MS);
                    record.lockedUntil = t + backoff;
                    must(await this.#storage.put(MEMBER_ACCOUNTS, record));
                    await this.#audit.append({
                        action: "member.account.locked",
                        actorId: record.id,
                        detail: {email, attempts: record.failedAttempts, lockedForMs: backoff},
                    });
                } else {
                    must(await this.#storage.put(MEMBER_ACCOUNTS, record));
                    await this.#audit.append({
                        action: "member.login.failed",
                        actorId: record.id,
                        detail: {email, attempts: record.failedAttempts},
                    });
                }
            }
            throw new PressError("unauthorized", "Invalid credentials");
        }

        if (!record.emailVerified) {
            throw new PressError("unauthorized", "Please verify your email address before logging in");
        }

        record.failedAttempts = 0;
        record.lockedUntil = null;
        must(await this.#storage.put(MEMBER_ACCOUNTS, record));

        const token = await this.#issueSession(record.id);
        await this.#audit.append({
            action: "member.login",
            actorId: record.id,
            detail: {email},
        });
        return {token, member: toPublic(record)};
    }

    async validateSession(token: string): Promise<Member | null> {
        const session = must(
            await this.#storage.get<MemberSessionRecord>(MEMBER_SESSIONS, tokenHash(token)),
        );
        if (!session || session.expiresAt <= this.#now()) return null;
        const member = must(
            await this.#storage.get<MemberAccountRecord>(MEMBER_ACCOUNTS, session.memberId),
        );
        if (!member || member.status === "suspended") return null;
        return toPublic(member);
    }

    async logout(token: string): Promise<void> {
        const id = tokenHash(token);
        const session = must(await this.#storage.get<MemberSessionRecord>(MEMBER_SESSIONS, id));
        if (!session) return;
        must(await this.#storage.delete(MEMBER_SESSIONS, id));
        await this.#audit.append({
            action: "member.logout",
            actorId: session.memberId,
            detail: {},
        });
    }

    async issueMagicToken(memberId: string): Promise<string> {
        const member = must(await this.#storage.get<MemberAccountRecord>(MEMBER_ACCOUNTS, memberId));
        if (!member) throw new PressError("not_found", "Member not found");
        return this.#issueToken(memberId, member.email, "magic_link", MAGIC_TOKEN_TTL_MS);
    }

    // --- Public API -----------------------------------------------------------

    async verifyMagicLink(input: { token: string }): Promise<MemberLoginResult> {
        const tokenRecord = await this.#consumeToken(input.token, "magic_link");
        const member = must(
            await this.#storage.get<MemberAccountRecord>(MEMBER_ACCOUNTS, tokenRecord.memberId),
        );
        if (!member) throw new PressError("not_found", "Member not found");
        if (member.status === "suspended") {
            throw new PressError("unauthorized", "This account has been suspended");
        }

        // Clicking the link proves inbox ownership — implicitly verify email.
        if (!member.emailVerified) {
            member.emailVerified = true;
            member.updatedAt = new Date(this.#now()).toISOString();
            must(await this.#storage.put(MEMBER_ACCOUNTS, member));
        }

        const sessionToken = await this.#issueSession(member.id);
        await this.#audit.append({
            action: "member.login.magic",
            actorId: member.id,
            detail: {email: member.email},
        });
        return {token: sessionToken, member: toPublic(member)};
    }

    async issuePasswordResetToken(memberId: string): Promise<string> {
        const member = must(await this.#storage.get<MemberAccountRecord>(MEMBER_ACCOUNTS, memberId));
        if (!member) throw new PressError("not_found", "Member not found");
        return this.#issueToken(memberId, member.email, "pw_reset", RESET_TOKEN_TTL_MS);
    }

    async confirmPasswordReset(input: { token: string; newPassword: string }): Promise<Member> {
        if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
            throw new PressError("validation", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        }
        const tokenRecord = await this.#consumeToken(input.token, "pw_reset");
        const member = must(
            await this.#storage.get<MemberAccountRecord>(MEMBER_ACCOUNTS, tokenRecord.memberId),
        );
        if (!member) throw new PressError("not_found", "Member not found");

        member.passwordHash = await hashPassword(input.newPassword);
        member.emailVerified = true; // reset proves inbox ownership
        member.failedAttempts = 0;
        member.lockedUntil = null;
        member.updatedAt = new Date(this.#now()).toISOString();
        must(await this.#storage.put(MEMBER_ACCOUNTS, member));
        await this.#audit.append({
            action: "member.password.reset",
            actorId: member.id,
            detail: {email: member.email},
        });
        return toPublic(member);
    }

    async getMember(id: string): Promise<Member | null> {
        const record = must(await this.#storage.get<MemberAccountRecord>(MEMBER_ACCOUNTS, id));
        return record ? toPublic(record) : null;
    }

    async getMemberByEmail(email: string): Promise<Member | null> {
        const record = await this.#findByEmail(email);
        return record ? toPublic(record) : null;
    }

    async updateProfile(
        memberId: string,
        input: { displayName?: string; bio?: string },
    ): Promise<Member> {
        const record = must(await this.#storage.get<MemberAccountRecord>(MEMBER_ACCOUNTS, memberId));
        if (!record) throw new PressError("not_found", "Member not found");

        if (input.displayName !== undefined) {
            const name = input.displayName.trim();
            if (!name) throw new PressError("validation", "Display name is required");
            if (name.length > MAX_DISPLAY_NAME_LENGTH) {
                throw new PressError("validation", `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`);
            }
            record.displayName = name;
        }
        if (input.bio !== undefined) {
            const bio = input.bio.trim();
            if (bio.length > MAX_BIO_LENGTH) {
                throw new PressError("validation", `Bio must be ${MAX_BIO_LENGTH} characters or fewer`);
            }
            record.bio = bio || null;
        }
        record.updatedAt = new Date(this.#now()).toISOString();
        must(await this.#storage.put(MEMBER_ACCOUNTS, record));
        return toPublic(record);
    }

    async #findByEmail(email: string): Promise<MemberAccountRecord | null> {
        const page = must(
            await this.#storage.query<MemberAccountRecord>(MEMBER_ACCOUNTS, {
                where: {email: normalizeEmail(email)},
            }),
        );
        return page.items[0] ?? null;
    }

    async #findToken(raw: string, type: TokenType): Promise<MemberTokenRecord | null> {
        const page = must(
            await this.#storage.query<MemberTokenRecord>(MEMBER_TOKENS, {
                where: {tokenHash: tokenHash(raw), type},
            }),
        );
        return page.items[0] ?? null;
    }

    async #pruneExpiredSessions(memberId: string, now: number): Promise<void> {
        const page = must(
            await this.#storage.query<MemberSessionRecord>(MEMBER_SESSIONS, {where: {memberId}}),
        );
        for (const s of page.items) {
            if (s.expiresAt <= now) await this.#storage.delete(MEMBER_SESSIONS, s.id);
        }
    }

    async #issueSession(memberId: string): Promise<string> {
        const now = this.#now();
        await this.#pruneExpiredSessions(memberId, now);
        const raw = randomBytes(32).toString("base64url");
        const session: MemberSessionRecord = {
            id: tokenHash(raw),
            memberId,
            expiresAt: now + SESSION_TTL_MS,
            createdAt: new Date(now).toISOString(),
        };
        must(await this.#storage.put(MEMBER_SESSIONS, session));
        return raw;
    }

    async #issueToken(memberId: string, email: string, type: TokenType, ttlMs: number): Promise<string> {
        const raw = randomBytes(32).toString("base64url");
        const now = this.#now();
        const record: MemberTokenRecord = {
            id: randomUUID(),
            memberId,
            email,
            type,
            tokenHash: tokenHash(raw),
            expiresAt: now + ttlMs,
            usedAt: null,
            createdAt: new Date(now).toISOString(),
        };
        must(await this.#storage.put(MEMBER_TOKENS, record));
        return raw;
    }

    async #consumeToken(raw: string, type: TokenType): Promise<MemberTokenRecord> {
        const record = await this.#findToken(raw, type);
        if (!record || record.usedAt !== null) {
            throw new PressError("unauthorized", "Invalid or already-used token");
        }
        if (record.expiresAt <= this.#now()) {
            throw new PressError("unauthorized", "This link has expired — please request a new one");
        }
        record.usedAt = new Date(this.#now()).toISOString();
        must(await this.#storage.put(MEMBER_TOKENS, record));
        return record;
    }
}

export async function createMemberAuthService(
    opts: MemberAuthServiceOptions,
): Promise<MemberAuthService> {
    const dummyHash = await hashPassword(randomBytes(16).toString("hex"));
    return new MemberAuthServiceImpl(opts, dummyHash);
}
