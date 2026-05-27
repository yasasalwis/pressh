import nodemailer from "nodemailer";
import type {AuditLog, SecretsBackend} from "@pressh/core";
import {PressError} from "@pressh/core";
import type {SettingsService} from "./settings.js";

/** The vault key under which the SMTP password is sealed (matches settings.ts). */
const SMTP_PASSWORD_SECRET = "smtp.password";

export interface EmailMessage {
    to: string;
    subject: string;
    html: string;
    /** Plain-text fallback shown by clients that do not render HTML. */
    text?: string;
}

export interface EmailService {
    /** Send an email. Throws PressError("validation") when SMTP is not configured. */
    send(msg: EmailMessage): Promise<void>;

    /** True when SMTP settings exist AND the password is stored in the vault. */
    isConfigured(): Promise<boolean>;

    /**
     * Open a real SMTP connection and verify credentials.
     * Useful for the Studio "Test connection" button.
     * Throws PressError("internal") on failure.
     */
    verify(): Promise<void>;
}

/** Minimal transport shape — satisfied by a real nodemailer transporter or a test double. */
export interface EmailTransport {
    sendMail(opts: {
        from: string;
        to: string;
        subject: string;
        html: string;
        text?: string;
    }): Promise<unknown>;

    verify(callback: (err: Error | null, success: boolean) => void): void;
}

export interface EmailServiceOptions {
    settings: SettingsService;
    secrets: SecretsBackend;
    audit: AuditLog;
    now?: () => number;
    /**
     * For tests: inject a pre-built transport and from-address, bypassing SMTP
     * settings and vault access entirely.
     */
    _test?: { transport: EmailTransport; from: string };
}

class EmailServiceImpl implements EmailService {
    readonly #settings: SettingsService;
    readonly #secrets: SecretsBackend;
    readonly #audit: AuditLog;
    readonly #test: { transport: EmailTransport; from: string } | undefined;

    constructor(opts: EmailServiceOptions) {
        this.#settings = opts.settings;
        this.#secrets = opts.secrets;
        this.#audit = opts.audit;
        this.#test = opts._test;
    }

    async send(msg: EmailMessage): Promise<void> {
        const {transport, from} = await this.#resolve();
        try {
            await transport.sendMail({
                from,
                to: msg.to,
                subject: msg.subject,
                html: msg.html,
                ...(msg.text !== undefined ? {text: msg.text} : {}),
            });
        } catch (err) {
            await this.#audit.append({
                action: "email.send.failed",
                actorId: null,
                detail: {subject: msg.subject, error: String(err)},
            });
            throw new PressError("internal", "Failed to send email — check SMTP settings");
        }
    }

    async isConfigured(): Promise<boolean> {
        if (this.#test) return true;
        const settings = await this.#settings.getSettings();
        if (!settings.smtp) return false;
        return settings.smtp.hasPassword;
    }

    async verify(): Promise<void> {
        const {transport} = await this.#resolve();
        await new Promise<void>((resolve, reject) => {
            transport.verify((err) => {
                if (err) {
                    reject(new PressError("internal", `SMTP verification failed: ${String(err)}`));
                } else {
                    resolve();
                }
            });
        });
    }

    async #resolve(): Promise<{ transport: EmailTransport; from: string }> {
        if (this.#test) return this.#test;

        const settings = await this.#settings.getSettings();
        if (!settings.smtp) {
            throw new PressError(
                "validation",
                "SMTP is not configured — set it in Studio → Settings",
            );
        }
        if (!settings.smtp.hasPassword) {
            throw new PressError(
                "validation",
                "SMTP password is not set — add it in Studio → Settings",
            );
        }

        const password = await this.#secrets.getSecret(SMTP_PASSWORD_SECRET);
        const transport: EmailTransport = nodemailer.createTransport({
            host: settings.smtp.host,
            port: settings.smtp.port,
            secure: settings.smtp.secure,
            auth: {user: settings.smtp.username, pass: password},
        });

        return {transport, from: settings.smtp.fromEmail};
    }
}

export function createEmailService(opts: EmailServiceOptions): EmailService {
    return new EmailServiceImpl(opts);
}
