import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PressError } from "../errors.js";
import type { Result } from "../result.js";
import type { AuditLog } from "../audit.js";
import type { StorageAdapter, StoredDoc } from "../storage/types.js";
import { hashPassword, verifyPassword } from "./password.js";
import { capabilitiesForRoles, isRoleName } from "./roles.js";
import type { RoleName } from "./roles.js";

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

interface UserRecord extends StoredDoc {
  email: string;
  passwordHash: string;
  roles: RoleName[];
  mfaEnabled: boolean;
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

export interface AuthServiceOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  now?: () => number;
  maxFailedAttempts?: number;
  lockoutMs?: number;
  sessionTtlMs?: number;
}

export interface AuthService {
  createUser(input: { email: string; password: string; roles: RoleName[] }): Promise<User>;
  authenticate(input: { email: string; password: string }): Promise<LoginResult>;
  validateSession(token: string): Promise<User | null>;
  logout(token: string): Promise<void>;
  capabilitiesFor(user: User): string[];
  getUserByEmail(email: string): Promise<User | null>;
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

class AuthServiceImpl implements AuthService {
  readonly #storage: StorageAdapter;
  readonly #audit: AuditLog;
  readonly #now: () => number;
  readonly #maxAttempts: number;
  readonly #lockoutMs: number;
  readonly #sessionTtlMs: number;
  readonly #dummyHash: string;

  constructor(opts: AuthServiceOptions, dummyHash: string) {
    this.#storage = opts.storage;
    this.#audit = opts.audit;
    this.#now = opts.now ?? (() => Date.now());
    this.#maxAttempts = opts.maxFailedAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#lockoutMs = opts.lockoutMs ?? DEFAULT_LOCKOUT_MS;
    this.#sessionTtlMs = opts.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.#dummyHash = dummyHash;
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

  async authenticate(input: { email: string; password: string }): Promise<LoginResult> {
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

      // Success: reset counters, prune this user's stale sessions, rotate a fresh
      // session in.
    record.failedAttempts = 0;
    record.lockedUntil = null;
    must(await this.#storage.put(USERS, record));
      await this.#pruneUserSessions(record.id, t);

    const token = randomBytes(32).toString("base64url");
    const session: SessionRecord = {
      id: tokenId(token),
      userId: record.id,
      createdAt: new Date(t).toISOString(),
      expiresAt: t + this.#sessionTtlMs,
      revoked: false,
    };
    must(await this.#storage.put(SESSIONS, session));
    await this.#audit.append({ action: "user.login", actorId: record.id, detail: { email } });

    return { token, user: toPublic(record) };
  }

  async validateSession(token: string): Promise<User | null> {
    const session = must(await this.#storage.get<SessionRecord>(SESSIONS, tokenId(token)));
    if (!session || session.revoked || session.expiresAt <= this.#now()) return null;
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

    return this.authenticate({ email: invite.email, password: input.password });
  }
}

export async function createAuthService(opts: AuthServiceOptions): Promise<AuthService> {
  // Precompute a dummy hash once so failed logins for unknown users take the
  // same time as for real users.
  const dummyHash = await hashPassword(randomBytes(16).toString("hex"));
  return new AuthServiceImpl(opts, dummyHash);
}
