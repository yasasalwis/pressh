import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PressError } from "../errors.js";
import type { Result } from "../result.js";
import type { AuditLog } from "../audit.js";
import type {SecretsBackend} from "../secrets.js";
import type { StorageAdapter, StoredDoc } from "../storage/types.js";
import { hashPassword, verifyPassword } from "./password.js";
import { capabilitiesForRoles, isRoleName } from "./roles.js";
import type { RoleName } from "./roles.js";
import {generateTotpSecret, otpauthUri, verifyTotp} from "./totp.js";

const USERS = "users";
const SESSIONS = "sessions";
const INVITES = "invites";
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000;
/** Upper bound on the exponential lockout backoff (24h). */
const MAX_LOCKOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
/** A password-verified login awaiting its TOTP code must complete within 5 min. */
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Code attempts allowed per challenge before it is discarded (anti-brute-force). */
const MAX_MFA_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;
/** Issuer label shown in the authenticator app. */
const MFA_ISSUER = "Pressh";
/** Vault secret name holding a user's TOTP seed. */
const mfaSecretName = (userId: string): string => `mfa:${userId}`;

interface UserRecord extends StoredDoc {
  email: string;
  passwordHash: string;
  roles: RoleName[];
  mfaEnabled: boolean;
    /** SHA-256 hashes of unused single-use recovery codes (the codes themselves are shown once). */
    mfaRecoveryHashes?: string[];
  status: "active" | "disabled";
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  createdAt: string;
}

interface SessionRecord extends StoredDoc {
  userId: string;
  createdAt: string;
  expiresAt: number;
  revoked: boolean;
    /** True while a password-verified login still awaits its TOTP code — NOT a valid session. */
    mfaPending?: boolean;
    /** Failed TOTP attempts against this pending challenge. */
    mfaAttempts?: number;
}

interface InviteRecord extends StoredDoc {
  email: string;
  roles: RoleName[];
  tokenHash: string;
  invitedBy: string | null;
  expiresAt: number;
  consumedAt: string | null;
  createdAt: string;
}

/** Public user shape — never includes the password hash or lockout counters. */
export interface User {
  id: string;
  email: string;
  roles: RoleName[];
  mfaEnabled: boolean;
  status: "active" | "disabled";
  /** When true, the user authenticated with an admin-set temp password and must rotate it. */
  mustChangePassword: boolean;
  createdAt: string;
}

/** Public invite shape — never includes the raw token or its hash. */
export interface Invite {
  id: string;
  email: string;
  roles: RoleName[];
  invitedBy: string | null;
  expiresAt: number;
  consumedAt: string | null;
  createdAt: string;
}

export interface LoginResult {
  token: string;
  user: User;
}

/** Returned by `authenticate` when the password is valid but a TOTP code is still required. */
export interface MfaChallenge {
    mfaRequired: true;
    /** Short-lived token to present alongside the code at `verifyMfaLogin`. */
    challenge: string;
}

export function isMfaChallenge(result: LoginResult | MfaChallenge): result is MfaChallenge {
    return (result as MfaChallenge).mfaRequired === true;
}

/** Enrollment payload — the secret/URI are shown ONCE so the user can add the authenticator. */
export interface MfaEnrollment {
    /** Base32 TOTP secret (manual-entry key). */
    secret: string;
    /** `otpauth://` URI for an authenticator app (QR or manual import). */
    otpauthUri: string;
}

export interface AuthServiceOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  now?: () => number;
  maxFailedAttempts?: number;
  lockoutMs?: number;
  sessionTtlMs?: number;
    /**
     * Vault used to store per-user TOTP seeds (`mfa:<userId>`), keeping them out of
     * the content DB. Required for MFA — enrollment fails closed without it.
     */
    secrets?: SecretsBackend;
}

export interface AuthService {
  createUser(input: { email: string; password: string; roles: RoleName[] }): Promise<User>;

    /**
     * Verifies the password. For an MFA-enabled user, returns an `MfaChallenge`
     * (no session issued yet); otherwise returns a full `LoginResult`.
     */
    authenticate(input: { email: string; password: string }): Promise<LoginResult | MfaChallenge>;

    /** Completes a two-step login: checks the TOTP (or a recovery) code, issues the session. */
    verifyMfaLogin(input: { challenge: string; code: string }): Promise<LoginResult>;
  validateSession(token: string): Promise<User | null>;
  logout(token: string): Promise<void>;
  capabilitiesFor(user: User): string[];
  getUserByEmail(email: string): Promise<User | null>;

    // --- MFA enrollment (gated by an authenticated session at the route layer) ---
    /** Begins TOTP enrollment: stores a fresh seed in the vault, returns the secret + URI. */
    beginMfaEnrollment(userId: string): Promise<MfaEnrollment>;

    /** Confirms enrollment with a code; enables MFA and returns one-time recovery codes. */
    confirmMfaEnrollment(userId: string, code: string): Promise<{ recoveryCodes: string[] }>;

    /** Disables MFA after verifying a current TOTP/recovery code; clears the seed + recovery codes. */
    disableMfa(userId: string, code: string): Promise<void>;
  /** True once at least one user exists — gates the first-run setup wizard. */
  hasAnyUser(): Promise<boolean>;

  // --- user administration (gated by `users.manage` at the route layer) ---
  /** All users, newest first. Never includes secrets. */
  listUsers(): Promise<User[]>;
  /** Single user by id. */
  getUser(id: string): Promise<User | null>;
  /**
   * Change a user's roles and/or status. Refuses to remove or disable the LAST
   * active owner so an install can never be locked out of administration.
   */
  updateUser(
    userId: string,
    changes: { roles?: RoleName[]; status?: "active" | "disabled" },
    actorId?: string,
  ): Promise<User>;
  /**
   * Create a user with a generated temporary password (the SMTP-less fallback).
   * The plaintext temp password is returned ONCE for the admin to relay; the
   * user is flagged `mustChangePassword` until they rotate it.
   */
  adminCreateUser(input: {
    email: string;
    roles: RoleName[];
    actorId?: string;
  }): Promise<{ user: User; temporaryPassword: string }>;
  /** Verify the current password and set a new one; clears `mustChangePassword`. */
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;

  // --- invitations (single-use, expiring; the user sets their own password) ---
  /** Create an invite and return its one-time token (shown/sent once). */
  createInvite(input: {
    email: string;
    roles: RoleName[];
    actorId?: string;
    ttlMs?: number;
  }): Promise<{ invite: Invite; token: string }>;
  /** Pending (unconsumed) invites, newest first. */
  listInvites(): Promise<Invite[]>;
  /** Permanently revoke a pending invite. */
  revokeInvite(id: string): Promise<void>;
  /** Redeem an invite token: create the user, consume the invite, return a session. */
  acceptInvite(input: { token: string; password: string }): Promise<LoginResult>;
}

function must<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toPublic(record: UserRecord): User {
  return {
    id: record.id,
    email: record.email,
    roles: record.roles,
    mfaEnabled: record.mfaEnabled,
    status: record.status,
    mustChangePassword: record.mustChangePassword ?? false,
    createdAt: record.createdAt,
  };
}

function toPublicInvite(record: InviteRecord): Invite {
  return {
    id: record.id,
    email: record.email,
    roles: record.roles,
    invitedBy: record.invitedBy,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
    createdAt: record.createdAt,
  };
}

/** A cryptographically strong, human-relayable temporary password. */
function generateTempPassword(): string {
  return randomBytes(12).toString("base64url");
}

function hashRecoveryCode(code: string): string {
    return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/** Strip formatting so "abcd-1234" and "ABCD 1234" match the stored hash. */
function normalizeRecoveryCode(code: string): string {
    return code.replace(/[\s-]/gu, "").toUpperCase();
}

/** 10-char codes shown as XXXXX-XXXXX; base32 alphabet avoids ambiguous chars. */
function generateRecoveryCodes(count: number): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
        const raw = randomBytes(7).toString("base64url").replace(/[^a-zA-Z0-9]/gu, "").toUpperCase().slice(0, 10).padEnd(10, "0");
        codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
    }
    return codes;
}

class AuthServiceImpl implements AuthService {
  readonly #storage: StorageAdapter;
  readonly #audit: AuditLog;
  readonly #now: () => number;
  readonly #maxAttempts: number;
  readonly #lockoutMs: number;
  readonly #sessionTtlMs: number;
  readonly #dummyHash: string;
    readonly #secrets: SecretsBackend | undefined;

  constructor(opts: AuthServiceOptions, dummyHash: string) {
    this.#storage = opts.storage;
    this.#audit = opts.audit;
    this.#now = opts.now ?? (() => Date.now());
    this.#maxAttempts = opts.maxFailedAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#lockoutMs = opts.lockoutMs ?? DEFAULT_LOCKOUT_MS;
    this.#sessionTtlMs = opts.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.#dummyHash = dummyHash;
      this.#secrets = opts.secrets;
  }

    /** Creates a full (non-pending) session for an authenticated user and audits the login. */
    async #issueSession(record: UserRecord, email: string): Promise<LoginResult> {
        const t = this.#now();
        const token = randomBytes(32).toString("base64url");
        const session: SessionRecord = {
            id: tokenId(token),
            userId: record.id,
            createdAt: new Date(t).toISOString(),
            expiresAt: t + this.#sessionTtlMs,
            revoked: false,
        };
        must(await this.#storage.put(SESSIONS, session));
        await this.#audit.append({action: "user.login", actorId: record.id, detail: {email}});
        return {token, user: toPublic(record)};
    }

    #requireSecrets(): SecretsBackend {
        if (!this.#secrets) {
            throw new PressError(
                "validation",
                "Two-factor auth requires the secrets vault. Set PRESSH_MASTER_KEY to enable it.",
            );
        }
        return this.#secrets;
  }

  async #findRecordByEmail(email: string): Promise<UserRecord | null> {
    const page = must(
      await this.#storage.query<UserRecord>(USERS, { where: { email: normalizeEmail(email) } }),
    );
    return page.items[0] ?? null;
  }

    /** Deletes a user's expired/revoked sessions so the store can't grow unbounded. */
    async #pruneUserSessions(userId: string, now: number): Promise<void> {
        const page = must(await this.#storage.query<SessionRecord>(SESSIONS, {where: {userId}}));
        for (const session of page.items) {
            if (session.revoked || session.expiresAt <= now) {
                await this.#storage.delete(SESSIONS, session.id);
            }
        }
    }

    /**
     * Revokes ALL of a user's active sessions — used when their roles or status
     * change so old capabilities can't outlive the change until natural expiry.
     */
    async #revokeUserSessions(userId: string): Promise<void> {
        const page = must(await this.#storage.query<SessionRecord>(SESSIONS, {where: {userId}}));
        for (const session of page.items) {
            await this.#storage.delete(SESSIONS, session.id);
        }
    }

  /** Shared user insertion: validates, hashes, persists, and audits. */
  async #insertUser(input: {
    email: string;
    password: string;
    roles: RoleName[];
    mustChangePassword: boolean;
    actorId: string | null;
  }): Promise<UserRecord> {
    const email = normalizeEmail(input.email);
    if (!email.includes("@")) throw new PressError("validation", "A valid email is required");
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new PressError("validation", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (input.roles.length === 0) throw new PressError("validation", "At least one role is required");
    for (const role of input.roles) {
      if (!isRoleName(role)) throw new PressError("validation", `Unknown role: ${role}`);
    }
    if (await this.#findRecordByEmail(email)) {
      throw new PressError("conflict", "A user with this email already exists");
    }

    const record: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(input.password),
      roles: input.roles,
      mfaEnabled: false,
      status: "active",
      mustChangePassword: input.mustChangePassword,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(this.#now()).toISOString(),
    };
    must(await this.#storage.put(USERS, record));
    await this.#audit.append({
      action: "user.create",
      actorId: input.actorId,
      detail: { userId: record.id, email },
    });
    return record;
  }

  async createUser(input: { email: string; password: string; roles: RoleName[] }): Promise<User> {
    const record = await this.#insertUser({
      email: input.email,
      password: input.password,
      roles: input.roles,
      mustChangePassword: false,
      actorId: null,
    });
    return toPublic(record);
  }

    async authenticate(input: { email: string; password: string }): Promise<LoginResult | MfaChallenge> {
    const email = normalizeEmail(input.email);
    const record = await this.#findRecordByEmail(email);
    const t = this.#now();
      const locked = record !== null && record.lockedUntil !== null && record.lockedUntil > t;

      // ALWAYS run a verify (against a dummy hash for unknown users, and even for a
      // locked account) so the response time is identical regardless of whether
      // the account exists or is locked — closing the enumeration/timing oracle
      // (FR-031, anti-enumeration).
      const passwordOk = record
          ? await verifyPassword(record.passwordHash, input.password)
          : await verifyPassword(this.#dummyHash, input.password);

      // A locked account is refused with the SAME generic error (and the same
      // timing) as a wrong password, so an attacker cannot distinguish "locked"
      // (account exists) from "bad credentials". The lockout is recorded in the
      // audit log for operators, never surfaced to the caller. We do NOT count an
      // attempt here — the lock already throttles. (Security over UX, by design:
      // a legitimate locked-out user sees the generic error until the window
      // elapses rather than us leaking that the account exists.)
      if (locked) {
      await this.#audit.append({
        action: "user.login.locked",
        actorId: record.id,
        detail: { email },
      });
          throw new PressError("unauthorized", "Invalid credentials");
    }

    if (!record || !passwordOk || record.status === "disabled") {
      if (record && record.status !== "disabled") {
          // Counter is NEVER reset on lockout (only on a successful login), so the
          // lock escalates instead of handing the attacker a fresh batch of
          // attempts every window. Once over the threshold, EVERY further failure
          // re-locks immediately with an exponentially longer backoff (capped),
          // so post-lockout an attacker gets at most one try per (growing) window.
        record.failedAttempts += 1;
        if (record.failedAttempts >= this.#maxAttempts) {
            const tier = Math.floor(record.failedAttempts / this.#maxAttempts);
            const backoff = Math.min(this.#lockoutMs * 2 ** (tier - 1), MAX_LOCKOUT_MS);
            record.lockedUntil = t + backoff;
          must(await this.#storage.put(USERS, record));
          await this.#audit.append({
            action: "user.account.locked",
            actorId: record.id,
              detail: {email, attempts: record.failedAttempts, lockedForMs: backoff},
          });
        } else {
          must(await this.#storage.put(USERS, record));
          await this.#audit.append({
            action: "user.login.failed",
            actorId: record.id,
            detail: { email, attempts: record.failedAttempts },
          });
        }
      }
      throw new PressError("unauthorized", "Invalid credentials");
    }

        // Password OK: reset the failure counter/lockout (the password factor
        // succeeded) and prune stale sessions.
    record.failedAttempts = 0;
    record.lockedUntil = null;
    must(await this.#storage.put(USERS, record));
      await this.#pruneUserSessions(record.id, t);

        // Second factor: when enabled, issue a SHORT-LIVED pending session (rejected by
        // validateSession) and return a challenge — the real session is minted only
        // after verifyMfaLogin checks the code.
        if (record.mfaEnabled) {
            const token = randomBytes(32).toString("base64url");
            const pending: SessionRecord = {
                id: tokenId(token),
                userId: record.id,
                createdAt: new Date(t).toISOString(),
                expiresAt: t + MFA_CHALLENGE_TTL_MS,
                revoked: false,
                mfaPending: true,
                mfaAttempts: 0,
            };
            must(await this.#storage.put(SESSIONS, pending));
            await this.#audit.append({action: "user.mfa.challenge", actorId: record.id, detail: {email}});
            return {mfaRequired: true, challenge: token};
        }

        return this.#issueSession(record, email);
    }

    async verifyMfaLogin(input: { challenge: string; code: string }): Promise<LoginResult> {
        const t = this.#now();
        const session = must(await this.#storage.get<SessionRecord>(SESSIONS, tokenId(input.challenge)));
        if (!session || !session.mfaPending || session.revoked || session.expiresAt <= t) {
            throw new PressError("unauthorized", "Invalid or expired login challenge");
        }
        const record = must(await this.#storage.get<UserRecord>(USERS, session.userId));
        if (!record || record.status === "disabled") {
            await this.#storage.delete(SESSIONS, session.id);
            throw new PressError("unauthorized", "Invalid or expired login challenge");
        }
        if ((session.mfaAttempts ?? 0) >= MAX_MFA_ATTEMPTS) {
            await this.#storage.delete(SESSIONS, session.id);
            throw new PressError("unauthorized", "Too many attempts — start over");
        }

        const secret = await this.#secrets?.getSecret(mfaSecretName(record.id)).catch(() => null);
        const totpOk = typeof secret === "string" && verifyTotp(secret, input.code, {time: t});
        const recoveryOk = !totpOk && this.#consumeRecoveryCode(record, input.code);

        if (!totpOk && !recoveryOk) {
            session.mfaAttempts = (session.mfaAttempts ?? 0) + 1;
            must(await this.#storage.put(SESSIONS, session));
            await this.#audit.append({
                action: "user.mfa.failed",
                actorId: record.id,
                detail: {attempts: session.mfaAttempts}
            });
            throw new PressError("unauthorized", "Invalid authentication code");
        }

        // Promote the pending session to a full one (same opaque token the client holds).
        if (recoveryOk) must(await this.#storage.put(USERS, record)); // a code was consumed
        session.mfaPending = false;
        session.mfaAttempts = 0;
        session.expiresAt = t + this.#sessionTtlMs;
    must(await this.#storage.put(SESSIONS, session));
        await this.#audit.append({
            action: "user.mfa.verify",
            actorId: record.id,
            detail: {method: totpOk ? "totp" : "recovery"},
        });
        await this.#audit.append({action: "user.login", actorId: record.id, detail: {email: record.email}});
        return {token: input.challenge, user: toPublic(record)};
    }

    /** Removes a matching unused recovery code from the record; true if one matched. */
    #consumeRecoveryCode(record: UserRecord, code: string): boolean {
        const hashes = record.mfaRecoveryHashes ?? [];
        const candidate = hashRecoveryCode(code);
        const idx = hashes.indexOf(candidate);
        if (idx === -1) return false;
        record.mfaRecoveryHashes = hashes.filter((_, i) => i !== idx);
        return true;
    }

    async beginMfaEnrollment(userId: string): Promise<MfaEnrollment> {
        const secrets = this.#requireSecrets();
        const record = must(await this.#storage.get<UserRecord>(USERS, userId));
        if (!record) throw new PressError("not_found", "User not found");
        const secret = generateTotpSecret();
        await secrets.setSecret(mfaSecretName(userId), secret);
        await this.#audit.append({action: "user.mfa.enroll.begin", actorId: userId, detail: {}});
        return {secret, otpauthUri: otpauthUri({secret, account: record.email, issuer: MFA_ISSUER})};
    }

    async confirmMfaEnrollment(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
        const secrets = this.#requireSecrets();
        const record = must(await this.#storage.get<UserRecord>(USERS, userId));
        if (!record) throw new PressError("not_found", "User not found");
        const secret = await secrets.getSecret(mfaSecretName(userId)).catch(() => null);
        if (!secret) throw new PressError("validation", "Start enrollment before confirming");
        if (!verifyTotp(secret, code, {time: this.#now()})) {
            throw new PressError("unauthorized", "Invalid authentication code");
        }
        const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
        record.mfaEnabled = true;
        record.mfaRecoveryHashes = recoveryCodes.map(hashRecoveryCode);
        must(await this.#storage.put(USERS, record));
        await this.#audit.append({action: "user.mfa.enable", actorId: userId, detail: {}});
        return {recoveryCodes};
    }

    async disableMfa(userId: string, code: string): Promise<void> {
        const record = must(await this.#storage.get<UserRecord>(USERS, userId));
        if (!record) throw new PressError("not_found", "User not found");
        if (!record.mfaEnabled) return; // idempotent
        const secret = await this.#secrets?.getSecret(mfaSecretName(userId)).catch(() => null);
        const ok =
            (typeof secret === "string" && verifyTotp(secret, code, {time: this.#now()})) ||
            this.#consumeRecoveryCode(record, code);
        if (!ok) throw new PressError("unauthorized", "Invalid authentication code");
        record.mfaEnabled = false;
        record.mfaRecoveryHashes = [];
        must(await this.#storage.put(USERS, record));
        await this.#secrets?.deleteSecret(mfaSecretName(userId)).catch(() => undefined);
        await this.#audit.append({action: "user.mfa.disable", actorId: userId, detail: {}});
  }

  async validateSession(token: string): Promise<User | null> {
    const session = must(await this.#storage.get<SessionRecord>(SESSIONS, tokenId(token)));
      // A pending (password-only) session is NOT a valid auth session until the
      // second factor is verified — treat it as no session at all.
      if (!session || session.revoked || session.mfaPending || session.expiresAt <= this.#now()) {
          return null;
      }
    const user = must(await this.#storage.get<UserRecord>(USERS, session.userId));
    if (!user || user.status === "disabled") return null;
    return toPublic(user);
  }

  async logout(token: string): Promise<void> {
    const id = tokenId(token);
    const session = must(await this.#storage.get<SessionRecord>(SESSIONS, id));
    if (!session) return;
    session.revoked = true;
    must(await this.#storage.put(SESSIONS, session));
    await this.#audit.append({ action: "user.logout", actorId: session.userId, detail: {} });
  }

  capabilitiesFor(user: User): string[] {
    return capabilitiesForRoles(user.roles);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const record = await this.#findRecordByEmail(email);
    return record ? toPublic(record) : null;
  }

  async hasAnyUser(): Promise<boolean> {
    const page = must(await this.#storage.query<UserRecord>(USERS, {}, { limit: 1 }));
    return page.items.length > 0;
  }

  async #allUserRecords(): Promise<UserRecord[]> {
    const page = must(await this.#storage.query<UserRecord>(USERS, {}));
    return page.items;
  }

  /** Active owners are the only accounts that can never all be removed. */
  #isLastActiveOwner(records: UserRecord[], target: UserRecord): boolean {
    const activeOwners = records.filter(
      (r) => r.status === "active" && r.roles.includes("owner"),
    );
    return (
      target.status === "active" &&
      target.roles.includes("owner") &&
      activeOwners.length <= 1
    );
  }

  async listUsers(): Promise<User[]> {
    const records = await this.#allUserRecords();
    return records
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(toPublic);
  }

  async getUser(id: string): Promise<User | null> {
    const record = must(await this.#storage.get<UserRecord>(USERS, id));
    return record ? toPublic(record) : null;
  }

  async updateUser(
    userId: string,
    changes: { roles?: RoleName[]; status?: "active" | "disabled" },
    actorId?: string,
  ): Promise<User> {
    const records = await this.#allUserRecords();
    const record = records.find((r) => r.id === userId);
    if (!record) throw new PressError("not_found", "User not found");

    const nextRoles = changes.roles ?? record.roles;
    const nextStatus = changes.status ?? record.status;
    if (changes.roles) {
      if (nextRoles.length === 0) throw new PressError("validation", "At least one role is required");
      for (const role of nextRoles) {
        if (!isRoleName(role)) throw new PressError("validation", `Unknown role: ${role}`);
      }
    }

    // Last-owner guard: block any change that would leave zero active owners.
    const losesOwnerStanding = !(nextStatus === "active" && nextRoles.includes("owner"));
    if (losesOwnerStanding && this.#isLastActiveOwner(records, record)) {
      throw new PressError("conflict", "Cannot remove or disable the last active owner");
    }

      const rolesChanged = changes.roles !== undefined && nextRoles.join(",") !== record.roles.join(",");
      const statusChanged = nextStatus !== record.status;

    record.roles = nextRoles;
    record.status = nextStatus;
    must(await this.#storage.put(USERS, record));
      // A privilege change must take effect immediately: revoke the user's
      // existing sessions so a still-open session can't keep its old capabilities
      // (or stay alive after the account is disabled) until natural expiry.
      if (rolesChanged || statusChanged) {
          await this.#revokeUserSessions(record.id);
      }
    await this.#audit.append({
      action: "user.update",
      actorId: actorId ?? null,
      detail: { userId: record.id, roles: record.roles, status: record.status },
    });
    return toPublic(record);
  }

  async adminCreateUser(input: {
    email: string;
    roles: RoleName[];
    actorId?: string;
  }): Promise<{ user: User; temporaryPassword: string }> {
    const temporaryPassword = generateTempPassword();
    const record = await this.#insertUser({
      email: input.email,
      password: temporaryPassword,
      roles: input.roles,
      mustChangePassword: true,
      actorId: input.actorId ?? null,
    });
    return { user: toPublic(record), temporaryPassword };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new PressError("validation", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const record = must(await this.#storage.get<UserRecord>(USERS, userId));
    if (!record) throw new PressError("not_found", "User not found");
    if (!(await verifyPassword(record.passwordHash, currentPassword))) {
      throw new PressError("unauthorized", "Current password is incorrect");
    }
    record.passwordHash = await hashPassword(newPassword);
    record.mustChangePassword = false;
    must(await this.#storage.put(USERS, record));
    await this.#audit.append({
      action: "user.password.change",
      actorId: userId,
      detail: { userId },
    });
  }

  async createInvite(input: {
    email: string;
    roles: RoleName[];
    actorId?: string;
    ttlMs?: number;
  }): Promise<{ invite: Invite; token: string }> {
    const email = normalizeEmail(input.email);
    if (!email.includes("@")) throw new PressError("validation", "A valid email is required");
    if (input.roles.length === 0) throw new PressError("validation", "At least one role is required");
    for (const role of input.roles) {
      if (!isRoleName(role)) throw new PressError("validation", `Unknown role: ${role}`);
    }
    if (await this.#findRecordByEmail(email)) {
      throw new PressError("conflict", "A user with this email already exists");
    }

    const token = randomBytes(32).toString("base64url");
    const now = this.#now();
    const record: InviteRecord = {
      id: randomUUID(),
      email,
      roles: input.roles,
      tokenHash: tokenId(token),
      invitedBy: input.actorId ?? null,
      expiresAt: now + (input.ttlMs ?? DEFAULT_INVITE_TTL_MS),
      consumedAt: null,
      createdAt: new Date(now).toISOString(),
    };
    must(await this.#storage.put(INVITES, record));
    await this.#audit.append({
      action: "user.invite.create",
      actorId: input.actorId ?? null,
      detail: { inviteId: record.id, email },
    });
    return { invite: toPublicInvite(record), token };
  }

  async listInvites(): Promise<Invite[]> {
    const page = must(await this.#storage.query<InviteRecord>(INVITES, {}));
    return page.items
      .filter((i) => i.consumedAt === null)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(toPublicInvite);
  }

  async revokeInvite(id: string): Promise<void> {
    const record = must(await this.#storage.get<InviteRecord>(INVITES, id));
    if (!record) return;
    must(await this.#storage.delete(INVITES, id));
    await this.#audit.append({
      action: "user.invite.revoke",
      actorId: null,
      detail: { inviteId: id },
    });
  }

  async acceptInvite(input: { token: string; password: string }): Promise<LoginResult> {
    const page = must(
      await this.#storage.query<InviteRecord>(INVITES, { where: { tokenHash: tokenId(input.token) } }),
    );
    const invite = page.items[0] ?? null;
    if (!invite || invite.consumedAt !== null) {
      throw new PressError("unauthorized", "Invalid or already-used invitation");
    }
    if (invite.expiresAt <= this.#now()) {
      throw new PressError("unauthorized", "This invitation has expired");
    }

    const record = await this.#insertUser({
      email: invite.email,
      password: input.password,
      roles: invite.roles,
      mustChangePassword: false,
      actorId: invite.invitedBy,
    });

    invite.consumedAt = new Date(this.#now()).toISOString();
    must(await this.#storage.put(INVITES, invite));
    await this.#audit.append({
      action: "user.invite.accept",
      actorId: record.id,
      detail: { inviteId: invite.id, userId: record.id },
    });

      // A freshly invited user has no MFA yet, so issue the session directly
      // (avoids re-verifying the password and the authenticate union).
      return this.#issueSession(record, record.email);
  }
}

export async function createAuthService(opts: AuthServiceOptions): Promise<AuthService> {
  // Precompute a dummy hash once so failed logins for unknown users take the
  // same time as for real users.
  const dummyHash = await hashPassword(randomBytes(16).toString("hex"));
  return new AuthServiceImpl(opts, dummyHash);
}
