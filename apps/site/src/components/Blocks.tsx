import type {ReactElement} from "react";
import type {BlockNode} from "@pressh/engine";

function clampLevel(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(6, Math.max(1, Math.floor(n))) : 2;
}

function Block({ block }: { readonly block: BlockNode }): ReactElement | null {
  switch (block.type) {
    case "paragraph":
      return <p dangerouslySetInnerHTML={{ __html: block.content ?? "" }} />;
    case "quote":
      return <blockquote dangerouslySetInnerHTML={{ __html: block.content ?? "" }} />;
    case "heading": {
      const level = clampLevel(block.props?.["level"]);
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag dangerouslySetInnerHTML={{ __html: block.content ?? "" }} />;
    }
    case "image": {
      const src = typeof block.props?.["src"] === "string" ? block.props["src"] : "";
      const alt = typeof block.props?.["alt"] === "string" ? block.props["alt"] : "";
      return src ? <img src={src} alt={alt} loading="lazy" /> : null;
    }
    case "code":
      return (
        <pre>
          <code>{block.content ?? ""}</code>
        </pre>
      );
    case "html":
      // Already sanitized at write time; safe to inject here.
      return <div dangerouslySetInnerHTML={{ __html: block.content ?? "" }} />;
    default:
      return null;
  }
}

export function Blocks({ blocks }: { readonly blocks: BlockNode[] }): ReactElement {
  return (
    <>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
      {blocks.flatMap((block, i) =>
        block.children?.length
          ? [<Blocks key={`c${i}`} blocks={block.children} />]
          : [],
      )}
    </>
  );
}
