/**
 * Pure HTML/text email template functions.
 *
 * Each function takes the minimum data needed (pre-built URLs, display strings)
 * and returns a { subject, html, text } triple ready to hand to EmailService.send().
 * All user-supplied strings are HTML-escaped before interpolation.
 */

export interface EmailTemplate {
    subject: string;
    html: string;
    text: string;
}

function escHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

function wrap(siteName: string, title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${escHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f4f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;">
        <tr>
          <td style="padding-bottom:24px;text-align:center;">
            <span style="font-size:22px;font-weight:700;color:#111827;letter-spacing:-0.5px;">${escHtml(siteName)}</span>
          </td>
        </tr>
        <tr>
          <td style="background:#fff;border-radius:12px;padding:40px 36px;box-shadow:0 1px 3px rgba(0,0,0,.08);">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding-top:24px;text-align:center;color:#9ca3af;font-size:13px;">
            This email was sent by ${escHtml(siteName)}.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctaButton(url: string, label: string): string {
    const safeUrl = escHtml(url);
    const safeLabel = escHtml(label);
    return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:28px 0 8px;">
    <tr>
      <td style="border-radius:8px;background:#111827;">
        <a href="${safeUrl}" style="display:inline-block;padding:12px 28px;color:#fff;font-weight:600;font-size:15px;text-decoration:none;border-radius:8px;mso-padding-alt:0;">${safeLabel}</a>
      </td>
    </tr>
  </table>
  <p style="margin:0 0 20px;font-size:13px;color:#6b7280;">
    Or copy this link: <a href="${safeUrl}" style="color:#111827;word-break:break-all;">${safeUrl}</a>
  </p>`;
}

function h1(text: string): string {
    return `<h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">${escHtml(text)}</h1>`;
}

function p(text: string, muted = false): string {
    const color = muted ? "#6b7280" : "#374151";
    return `<p style="margin:0 0 10px;font-size:15px;color:${color};line-height:1.6;">${escHtml(text)}</p>`;
}

// ---------------------------------------------------------------------------

export function verificationEmail(opts: { verifyUrl: string; siteName: string }): EmailTemplate {
    const {verifyUrl, siteName} = opts;
    const subject = `Verify your email — ${siteName}`;
    const html = wrap(
        siteName,
        subject,
        h1("Verify your email address") +
        p("Thanks for signing up. Click below to confirm your email and activate your account.") +
        p("This link expires in 24 hours.", true) +
        ctaButton(verifyUrl, "Verify email address") +
        p("If you didn't create an account, you can safely ignore this email.", true),
    );
    const text = [
        `Verify your email — ${siteName}`,
        "",
        "Click the link below to confirm your email address (expires in 24 hours):",
        verifyUrl,
        "",
        "If you didn't create an account, ignore this email.",
    ].join("\n");
    return {subject, html, text};
}

export function magicLinkEmail(opts: { magicUrl: string; siteName: string }): EmailTemplate {
    const {magicUrl, siteName} = opts;
    const subject = `Your sign-in link — ${siteName}`;
    const html = wrap(
        siteName,
        subject,
        h1("Your sign-in link") +
        p("Click the button below to sign in. This link can only be used once.") +
        p("This link expires in 15 minutes.", true) +
        ctaButton(magicUrl, "Sign in") +
        p("If you didn't request this link, you can safely ignore this email.", true),
    );
    const text = [
        `Your sign-in link — ${siteName}`,
        "",
        "Click the link below to sign in (one-time use, expires in 15 minutes):",
        magicUrl,
        "",
        "If you didn't request this, ignore this email.",
    ].join("\n");
    return {subject, html, text};
}

export function passwordResetEmail(opts: { resetUrl: string; siteName: string }): EmailTemplate {
    const {resetUrl, siteName} = opts;
    const subject = `Reset your password — ${siteName}`;
    const html = wrap(
        siteName,
        subject,
        h1("Reset your password") +
        p("We received a request to reset your password. Click below to choose a new one.") +
        p("This link expires in 1 hour.", true) +
        ctaButton(resetUrl, "Reset password") +
        p("If you didn't request a password reset, you can safely ignore this email.", true),
    );
    const text = [
        `Reset your password — ${siteName}`,
        "",
        "Click the link below to reset your password (expires in 1 hour):",
        resetUrl,
        "",
        "If you didn't request a password reset, ignore this email.",
    ].join("\n");
    return {subject, html, text};
}

export function welcomeEmail(opts: { displayName: string; siteName: string }): EmailTemplate {
    const {displayName, siteName} = opts;
    const subject = `Welcome to ${siteName}`;
    const html = wrap(
        siteName,
        subject,
        h1(`Welcome, ${displayName}!`) + p("Your account is ready. We're glad to have you."),
    );
    const text = [
        `Welcome to ${siteName}`,
        "",
        `Hi ${displayName},`,
        "",
        "Your account is ready. We're glad to have you.",
    ].join("\n");
    return {subject, html, text};
}

export function subscribeConfirmEmail(opts: {
    confirmUrl: string;
    unsubscribeUrl: string;
    siteName: string;
}): EmailTemplate {
    const {confirmUrl, unsubscribeUrl, siteName} = opts;
    const subject = `Confirm your subscription — ${siteName}`;
    const html = wrap(
        siteName,
        subject,
        h1("Confirm your subscription") +
        p(`You asked to subscribe to ${siteName}. Click below to confirm — we won't send anything until you do.`) +
        p("This link expires in 24 hours.", true) +
        ctaButton(confirmUrl, "Confirm subscription") +
        p("If you didn't request this, you can safely ignore this email.", true) +
        `<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">
          Don't want to subscribe? <a href="${escHtml(unsubscribeUrl)}" style="color:#9ca3af;">Unsubscribe</a>
        </p>`,
    );
    const text = [
        `Confirm your subscription — ${siteName}`,
        "",
        `You asked to subscribe to ${siteName}. Click the link below to confirm (expires in 24 hours):`,
        confirmUrl,
        "",
        "If you didn't request this, ignore this email.",
        "",
        `Unsubscribe: ${unsubscribeUrl}`,
    ].join("\n");
    return {subject, html, text};
}

export function inviteEmail(opts: {
    inviteUrl: string;
    siteName: string;
    inviterEmail?: string;
}): EmailTemplate {
    const {inviteUrl, siteName, inviterEmail} = opts;
    const subject = `You've been invited to ${siteName}`;
    const intro = inviterEmail
        ? `${inviterEmail} has invited you to join ${siteName}.`
        : `You've been invited to join ${siteName}.`;
    const html = wrap(
        siteName,
        subject,
        h1("You're invited!") +
        p(intro) +
        p("This invitation expires in 7 days.", true) +
        ctaButton(inviteUrl, "Accept invitation") +
        p("If you weren't expecting this invitation, you can safely ignore this email.", true),
    );
    const byLine = inviterEmail ? `${inviterEmail} has invited you to join ` : `You've been invited to join `;
    const text = [
        `${byLine}${siteName}`,
        "",
        "Accept your invitation here (expires in 7 days):",
        inviteUrl,
        "",
        "If you weren't expecting this, ignore this email.",
    ].join("\n");
    return {subject, html, text};
}
