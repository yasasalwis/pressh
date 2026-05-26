import type {ReactElement} from "react";
import type {BlockNode} from "@pressh/engine";

export interface PageData {
  blocks: BlockNode[];
  title: string;
  locale: string;
}

interface PageProps extends PageData {
    /** Pre-rendered HTML for the body root div (from renderTree or Blocks SSR). */
  bodyHtml: string;
  extraStyles?: string;
  clientScript?: string;
  clientStyles?: readonly string[];
}

export function Page({
  title,
  locale,
  blocks,
  bodyHtml,
  extraStyles,
  clientScript,
  clientStyles,
}: PageProps): ReactElement {
  // Serialise page data for client hydration. Escaping </ prevents the JSON
  // from breaking out of the script tag if content contains "</script>".
  const serialised = JSON.stringify({ blocks, title, locale } satisfies PageData).replace(
    /<\//g,
    "<\\/",
  );

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{`*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}`}</style>
        {extraStyles ? <style>{extraStyles}</style> : null}
        {clientStyles?.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>
        <div id="root" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        {/* type="application/json" is never executed — CSP script-src does not apply */}
        <script
          type="application/json"
          id="pressh-data"
          dangerouslySetInnerHTML={{ __html: serialised }}
        />
        {clientScript ? <script type="module" src={clientScript} /> : null}
      </body>
    </html>
  );
}
