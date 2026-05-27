// Property-panel field config: per-type content fields + reusable style presets.

export interface ContentField {
    k: string;
    l: string;
    t: "text" | "textarea" | "select" | "number" | "checkbox";
    o?: string[];
}

export function contentFields(type: string): ContentField[] {
    switch (type) {
        case "heading":
            return [
                {k: "text", l: "Text", t: "text"},
                {k: "level", l: "Heading level", t: "select", o: ["1", "2", "3", "4", "5", "6"]},
            ];
        case "text":
            return [{k: "text", l: "Text", t: "textarea"}];
        case "button":
            return [
                {k: "label", l: "Label", t: "text"},
                {k: "href", l: "Link URL", t: "text"},
            ];
        case "image":
            return [
                {k: "src", l: "Image URL", t: "text"},
                {k: "alt", l: "Alt text", t: "text"},
            ];
        case "icon":
            return [{k: "name", l: "Icon name", t: "text"}];
        case "video":
            return [
                {k: "url", l: "Video URL (https)", t: "text"},
                {k: "title", l: "Title", t: "text"},
            ];
        case "list":
            return [{k: "ordered", l: "Numbered list", t: "checkbox"}];
        case "listItem":
            return [{k: "text", l: "Text", t: "text"}];
        case "collectionList":
            return [
                {k: "limit", l: "Max items", t: "number"},
                {k: "order", l: "Order", t: "select", o: ["desc", "asc"]},
                {k: "emptyText", l: "Empty message", t: "text"},
            ];
        case "form":
            return [{k: "action", l: "Submit URL", t: "text"}];
        case "input":
            return [
                {k: "label", l: "Label", t: "text"},
                {k: "name", l: "Field name", t: "text"},
                {
                    k: "inputType",
                    l: "Input type",
                    t: "select",
                    o: ["text", "email", "tel", "number", "password", "url", "date"]
                },
                {k: "placeholder", l: "Placeholder", t: "text"},
                {k: "required", l: "Required", t: "checkbox"},
            ];
        case "textarea":
            return [
                {k: "label", l: "Label", t: "text"},
                {k: "name", l: "Field name", t: "text"},
                {k: "placeholder", l: "Placeholder", t: "text"},
                {k: "rows", l: "Rows", t: "number"},
            ];
        case "submit":
            return [{k: "label", l: "Label", t: "text"}];
        default:
            return [];
    }
}

export const SPACE_OPTS = ["0", "0.25rem", "0.5rem", "0.75rem", "1rem", "1.5rem", "2rem", "3rem", "4rem", "auto"];
export const COLOR_OPTS = [
    "token:colorPrimary",
    "token:colorText",
    "token:colorBackground",
    "#ffffff",
    "#000000",
    "transparent",
];
export const STYLE_PRESETS: Record<string, string[]> = {
    width: ["auto", "100%", "75%", "50%", "33%", "320px", "480px", "640px"],
    maxWidth: ["none", "1280px", "1100px", "960px", "760px", "640px", "100%"],
    minHeight: ["0", "120px", "240px", "360px", "480px", "100vh"],
    height: ["auto", "120px", "240px", "360px", "480px", "100vh"],
    maxHeight: ["none", "240px", "360px", "480px", "640px", "100vh"],
    fontSize: ["0.75rem", "0.875rem", "1rem", "1.125rem", "1.25rem", "1.5rem", "2rem", "2.5rem", "3rem", "3.5rem"],
    lineHeight: ["1", "1.1", "1.2", "1.4", "1.6", "1.8"],
    letterSpacing: ["normal", "-0.04em", "-0.02em", "0.02em", "0.06em"],
    fontFamily: ["token:fontBody", "token:fontHeading", "system-ui, sans-serif", "Georgia, serif", "'Times New Roman', serif", "'Courier New', monospace"],
    gap: ["0", "0.25rem", "0.5rem", "0.75rem", "1rem", "1.5rem", "2rem", "3rem"],
    borderWidth: ["0", "1px", "2px", "3px", "4px"],
    borderRadius: ["0", "4px", "8px", "12px", "16px", "24px", "32px", "999px"],
};
