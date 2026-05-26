import type {ReactElement} from "react";

interface DocumentProps {
    title: string;
    locale?: string;
    /** Pre-rendered body HTML (themed layout, Blocks SSR, or a small fragment). */
    body: string;
    extraStyles?: string;
}

/**
 * Minimal standalone HTML document used for fallback/system pages (maintenance,
 * 404, 500) — i.e. whenever the themed renderer is unavailable or page
 * resolution fails. The richer hydrated page lives in `Page.tsx`; this shell
 * carries no client bundle. `body` is already-rendered, escaped HTML.
 */
export function Document({title, locale = "en", body, extraStyles}: DocumentProps): ReactElement {
    return (
        <html lang={locale}>
        <head>
            <meta charSet="utf-8"/>
            <meta name="viewport" content="width=device-width, initial-scale=1"/>
            <title>{title}</title>
            <style>{"*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}"}</style>
            {extraStyles ? <style>{extraStyles}</style> : null}
        </head>
        <body dangerouslySetInnerHTML={{__html: body}}/>
        </html>
    );
}
