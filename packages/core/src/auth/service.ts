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
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface UserRecord extends StoredDoc {
  email: string;
  passwordHash: string;
  roles: RoleName[];
  mfaEnabled: boolean;
  status: "active" | "disabled";
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

/** Public user shape — never includes the password hash or lockout counters. */
export interface User {
  id: string;
  email: string;
  roles: RoleName[];
  mfaEnabled: boolean;
  status: "active" | "disabled";
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
    createdAt: record.createdAt,
  };
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

  async createUser(input: { email: string; password: string; roles: RoleName[] }): Promise<User> {
    const email = normalizeEmail(input.email);
    if (!email.includes("@")) throw new PressError("validation", "A valid email is required");
    if (input.password.length < 8) {
      throw new PressError("validation", "Password must be at least 8 characters");
    }
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
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(this.#now()).toISOString(),
    };
    must(await this.#storage.put(USERS, record));
    await this.#audit.append({
      action: "user.create",
      actorId: null,
      detail: { userId: record.id, email },
    });
    return toPublic(record);
  }

  async authenticate(input: { email: string; password: string }): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const record = await this.#findRecordByEmail(email);
    const t = this.#now();

    // Lockout check before verifying — but the response stays generic.
    if (record && record.lockedUntil !== null && record.lockedUntil > t) {
      await this.#audit.append({
        action: "user.login.locked",
        actorId: record.id,
        detail: { email },
      });
      throw new PressError("rate_limited", "Too many attempts, try again later");
    }

    // Always run a verify (against a dummy hash for unknown users) to equalize
    // timing and avoid user enumeration (FR-031, anti-enumeration).
    const passwordOk = record
      ? await verifyPassword(record.passwordHash, input.password)
      : await verifyPassword(this.#dummyHash, input.password);

    if (!record || !passwordOk || record.status === "disabled") {
      if (record && record.status !== "disabled") {
        record.failedAttempts += 1;
        if (record.failedAttempts >= this.#maxAttempts) {
          record.lockedUntil = t + this.#lockoutMs;
          record.failedAttempts = 0;
          must(await this.#storage.put(USERS, record));
          await this.#audit.append({
            action: "user.account.locked",
            actorId: record.id,
            detail: { email },
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

    // Success: reset counters and rotate in a fresh session.
    record.failedAttempts = 0;
    record.lockedUntil = null;
    must(await this.#storage.put(USERS, record));

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
}

export async function createAuthService(opts: AuthServiceOptions): Promise<AuthService> {
  // Precompute a dummy hash once so failed logins for unknown users take the
  // same time as for real users.
  const dummyHash = await hashPassword(randomBytes(16).toString("hex"));
  return new AuthServiceImpl(opts, dummyHash);
}
