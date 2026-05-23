import { CapabilityGate, PressError } from "@pressh/core";
import type { AuditLog, SecretsBackend, StorageAdapter, StoredDoc } from "@pressh/core";

/**
 * General site settings (FR — operator configuration). These are the cross-cutting
 * knobs the Studio's Settings screen edits: the public base URL (used for
 * sitemap/canonical links), the default content locale, the display timezone, and
 * outbound email (SMTP) configuration.
 *
 * Security: the SMTP password is NEVER stored in the settings document or returned
 * to the client. It is sealed in the secrets vault ([[pressh-security-model]]
 * baseline #7). When no vault is configured the screen still works but SMTP
 * password storage is disabled and reported as such.
 */
const SETTINGS_COLLECTION = "settings";
const GENERAL_DOC_ID = "general";
const SMTP_PASSWORD_SECRET = "smtp.password";

const BASE_URL_RE = /^https?:\/\/[^\s]+$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  fromEmail: string;
  username: string;
}

interface StoredGeneralSettings extends StoredDoc {
  baseUrl: string;
  defaultLocale: string;
  timezone: string;
  smtp: SmtpSettings | null;
}

/** Public view: adds whether an SMTP password is on file, never the value. */
export interface GeneralSettings {
  baseUrl: string;
  defaultLocale: string;
  timezone: string;
  smtp: (SmtpSettings & { hasPassword: boolean }) | null;
  /** False when no secrets backend is configured (PRESSH_MASTER_KEY unset). */
  smtpAvailable: boolean;
}

export interface UpdateSettingsInput {
  baseUrl?: string;
  defaultLocale?: string;
  timezone?: string;
  /** Pass an object to set SMTP config, or `null` to clear it (and its password). */
  smtp?: SmtpSettings | null;
  /** Plaintext SMTP password; sealed into the vault, never persisted in the doc. */
  smtpPassword?: string;
}

export interface SettingsService {
  getSettings(): Promise<GeneralSettings>;
  updateSettings(capabilities: string[], partial: UpdateSettingsInput): Promise<GeneralSettings>;
}

export interface SettingsServiceOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  /** Optional sealed vault for the SMTP password. Omit to disable SMTP secrets. */
  secrets?: SecretsBackend;
  now?: () => number;
}

const DEFAULTS = {
  baseUrl: "",
  defaultLocale: "en",
  timezone: "UTC",
  smtp: null as SmtpSettings | null,
};

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function validateSmtp(smtp: SmtpSettings): void {
  if (!smtp.host.trim()) throw new PressError("validation", "SMTP host is required");
  if (!Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535) {
    throw new PressError("validation", "SMTP port must be between 1 and 65535");
  }
  if (!smtp.fromEmail.includes("@")) {
    throw new PressError("validation", "A valid SMTP from-address is required");
  }
}

export function createSettingsService(opts: SettingsServiceOptions): SettingsService {
  const gate = new CapabilityGate();

  async function readDoc(): Promise<StoredGeneralSettings> {
    const result = await opts.storage.get<StoredGeneralSettings>(SETTINGS_COLLECTION, GENERAL_DOC_ID);
    if (!result.ok) throw result.error;
    return result.value ?? { id: GENERAL_DOC_ID, ...DEFAULTS };
  }

  async function toView(doc: StoredGeneralSettings): Promise<GeneralSettings> {
    const smtpAvailable = opts.secrets !== undefined;
    let smtp: GeneralSettings["smtp"] = null;
    if (doc.smtp) {
      const hasPassword = opts.secrets ? await opts.secrets.hasSecret(SMTP_PASSWORD_SECRET) : false;
      smtp = { ...doc.smtp, hasPassword };
    }
    return {
      baseUrl: doc.baseUrl,
      defaultLocale: doc.defaultLocale,
      timezone: doc.timezone,
      smtp,
      smtpAvailable,
    };
  }

  return {
    async getSettings() {
      return toView(await readDoc());
    },

    async updateSettings(capabilities, partial) {
      gate.assert(capabilities, "settings.manage");
      const doc = await readDoc();

      if (partial.baseUrl !== undefined) {
        const v = partial.baseUrl.trim();
        if (v !== "" && !BASE_URL_RE.test(v)) {
          throw new PressError("validation", "Base URL must be an http(s) URL or empty");
        }
        doc.baseUrl = v;
      }
      if (partial.defaultLocale !== undefined) {
        if (!LOCALE_RE.test(partial.defaultLocale)) {
          throw new PressError("validation", "Locale must look like 'en' or 'en-US'");
        }
        doc.defaultLocale = partial.defaultLocale;
      }
      if (partial.timezone !== undefined) {
        if (!isValidTimezone(partial.timezone)) {
          throw new PressError("validation", `Unknown timezone: ${partial.timezone}`);
        }
        doc.timezone = partial.timezone;
      }
      if (partial.smtp !== undefined) {
        if (partial.smtp === null) {
          doc.smtp = null;
          if (opts.secrets && (await opts.secrets.hasSecret(SMTP_PASSWORD_SECRET))) {
            await opts.secrets.deleteSecret(SMTP_PASSWORD_SECRET);
          }
        } else {
          validateSmtp(partial.smtp);
          doc.smtp = partial.smtp;
        }
      }
      if (partial.smtpPassword !== undefined && partial.smtpPassword !== "") {
        if (!opts.secrets) {
          throw new PressError(
            "validation",
            "Secrets vault is not configured — set PRESSH_MASTER_KEY to store SMTP credentials",
          );
        }
        await opts.secrets.setSecret(SMTP_PASSWORD_SECRET, partial.smtpPassword, "smtp");
      }

      const put = await opts.storage.put(SETTINGS_COLLECTION, doc);
      if (!put.ok) throw put.error;
      await opts.audit.append({
        action: "settings.update",
        actorId: null,
        detail: { baseUrl: doc.baseUrl, defaultLocale: doc.defaultLocale, timezone: doc.timezone, smtp: doc.smtp !== null },
      });
      return toView(doc);
    },
  };
}
