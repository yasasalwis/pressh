import {createElement} from "react";
import {renderToString} from "react-dom/server";
import {Document} from "./components/Document.js";

/** HTML-escape for text/attribute contexts (meta tags, sitemap XML, asset hrefs). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wraps pre-rendered body HTML in the minimal standalone document shell. */
export function renderPage(opts: {
    title: string;
    body: string;
    locale?: string;
    extraStyles?: string;
}): string {
    return (
        "<!DOCTYPE html>" +
        renderToString(
            createElement(Document, {
                title: opts.title,
                locale: opts.locale ?? "en",
                body: opts.body,
                ...(opts.extraStyles ? {extraStyles: opts.extraStyles} : {}),
            }),
        )
    );
}

export function renderNotFound(): string {
    return renderPage({title: "Not found", body: renderToString(createElement("h1", null, "404 — Not found"))});
}

export function renderServerError(): string {
    return renderPage({title: "Error", body: renderToString(createElement("h1", null, "500 — Server error"))});
}

/** Last-resort maintenance page when the operator's system page can't be resolved. */
export function renderMaintenanceFallback(): string {
    return renderPage({
        title: "Down for maintenance",
        body: renderToString(
            createElement(
                "div",
                null,
                createElement("h1", null, "We’ll be right back"),
                createElement(
                    "p",
                    null,
                    "The site is temporarily offline for scheduled maintenance. Please check back shortly.",
                ),
            ),
        ),
    });
}
