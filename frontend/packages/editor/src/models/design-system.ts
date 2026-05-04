import { StyleClass } from "./style";

// ---------------------------------------------------------------------------
// Public types & metadata
// ---------------------------------------------------------------------------

export type DesignSystemName = "modern" | "classic" | "technical" | "minimal";

export interface DesignSystemMeta {
  name: DesignSystemName;
  label: string;
  description: string;
}

export const DESIGN_SYSTEMS: DesignSystemMeta[] = [
  {
    name: "modern",
    label: "Modern",
    description: "Clean sans-serif, slate tones, generous spacing",
  },
  {
    name: "classic",
    label: "Classic",
    description: "Serif typeface, traditional document proportions",
  },
  {
    name: "technical",
    label: "Technical",
    description: "Monospace-influenced, tight grid, engineering docs",
  },
  {
    name: "minimal",
    label: "Minimal",
    description: "Maximum whitespace, hairline rules, ultra-clean",
  },
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDesignSystem(name: DesignSystemName): StyleClass[] {
  switch (name) {
    case "modern":
      return createModern();
    case "classic":
      return createClassic();
    case "technical":
      return createTechnical();
    case "minimal":
      return createMinimal();
  }
}

// ---------------------------------------------------------------------------
// modern — Inter/system-ui, slate palette, generous spacing
// ---------------------------------------------------------------------------

function createModern(): StyleClass[] {
  return [
    new StyleClass(
      "title",
      "Title",
      "h1",
      {
        fontSize: "32px",
        fontWeight: "700",
        color: "#0f172a",
        textAlign: "center",
        lineHeight: "1.1",
        marginBottom: "28px",
      },
      true,
    ),
    new StyleClass(
      "heading1",
      "Heading 1",
      "h1",
      {
        fontSize: "26px",
        fontWeight: "700",
        color: "#1e293b",
        textAlign: "left",
        lineHeight: "1.2",
        marginBottom: "14px",
        marginTop: "28px",
      },
      true,
    ),
    new StyleClass(
      "heading2",
      "Heading 2",
      "h2",
      {
        fontSize: "21px",
        fontWeight: "600",
        color: "#1e293b",
        textAlign: "left",
        lineHeight: "1.25",
        marginBottom: "10px",
        marginTop: "20px",
      },
      true,
    ),
    new StyleClass(
      "heading3",
      "Heading 3",
      "h3",
      {
        fontSize: "17px",
        fontWeight: "600",
        color: "#334155",
        textAlign: "left",
        lineHeight: "1.3",
        marginBottom: "8px",
        marginTop: "16px",
      },
      true,
    ),
    new StyleClass(
      "lead",
      "Lead",
      "p",
      {
        fontSize: "17px",
        fontWeight: "400",
        color: "#334155",
        textAlign: "left",
        lineHeight: "1.7",
        marginBottom: "16px",
      },
      true,
    ),
    new StyleClass(
      "body",
      "Body",
      "p",
      {
        fontSize: "14px",
        fontWeight: "400",
        color: "#334155",
        textAlign: "left",
        lineHeight: "1.65",
        marginBottom: "12px",
        letterSpacing: "0.1px",
      },
      true,
    ),
    new StyleClass(
      "body-sm",
      "Body Small",
      "p",
      {
        fontSize: "12px",
        fontWeight: "400",
        color: "#475569",
        textAlign: "left",
        lineHeight: "1.6",
        marginBottom: "8px",
      },
      true,
    ),
    new StyleClass(
      "subtitle",
      "Subtitle",
      "p",
      {
        fontSize: "16px",
        fontWeight: "400",
        color: "#64748b",
        textAlign: "center",
        lineHeight: "1.4",
        marginBottom: "20px",
      },
      true,
    ),
    new StyleClass(
      "caption",
      "Caption",
      "figcaption",
      {
        fontSize: "11px",
        fontStyle: "italic",
        color: "#64748b",
        textAlign: "center",
        lineHeight: "1.4",
        marginBottom: "6px",
        marginTop: "4px",
      },
      true,
    ),
    new StyleClass(
      "quote",
      "Quote",
      "p",
      {
        fontSize: "15px",
        fontStyle: "italic",
        color: "#475569",
        textAlign: "left",
        lineHeight: "1.65",
        marginBottom: "16px",
        marginTop: "4px",
        borderLeft: "3px solid #e2e8f0",
        paddingLeft: "16px",
      },
      true,
    ),
    new StyleClass(
      "note",
      "Note",
      "p",
      {
        fontSize: "12px",
        fontWeight: "400",
        color: "#64748b",
        textAlign: "left",
        lineHeight: "1.5",
        marginBottom: "12px",
        backgroundColor: "#f8fafc",
        padding: "8px 12px",
        borderRadius: "4px",
      },
      true,
    ),
    new StyleClass(
      "code",
      "Code",
      "code",
      {
        fontSize: "12px",
        fontFamily: "monospace",
        color: "#7c3aed",
        backgroundColor: "#f5f3ff",
        padding: "2px 6px",
        borderRadius: "3px",
      },
      true,
    ),
    new StyleClass(
      "table-info",
      "Info Table",
      "table",
      {
        fontSize: "13px",
        color: "#1e293b",
        lineHeight: "1.5",
        marginBottom: "16px",
        marginTop: "8px",
      },
      true,
    ),
    new StyleClass(
      "footer-text",
      "Footer Text",
      "p",
      {
        fontSize: "11px",
        color: "#64748b",
        lineHeight: "1.5",
        marginBottom: "0px",
        marginTop: "0px",
      },
      true,
    ),
    new StyleClass(
      "footer-note",
      "Footer Note",
      "p",
      {
        fontSize: "10px",
        color: "#94a3b8",
        lineHeight: "1.4",
        marginBottom: "0px",
        marginTop: "0px",
      },
      true,
    ),
    new StyleClass(
      "footer-container",
      "Footer Container",
      "hbox",
      {
        marginTop: "24px",
        marginBottom: "8px",
      },
      true,
    ),
    new StyleClass(
      "footer-bar-container",
      "Footer Bar",
      "hbox",
      {
        marginTop: "4px",
        marginBottom: "0px",
        borderTop: "1px solid #e2e8f0",
        paddingTop: "4px",
      },
      true,
    ),
    new StyleClass(
      "footer-column",
      "Footer Column",
      "vbox",
      {
        flex: "1",
      },
      true,
    ),
  ];
}

// ---------------------------------------------------------------------------
// classic — Georgia/serif, warm neutrals
// ---------------------------------------------------------------------------

function createClassic(): StyleClass[] {
  return [
    new StyleClass(
      "title",
      "Title",
      "h1",
      {
        fontSize: "30px",
        fontWeight: "700",
        color: "#1a1a1a",
        textAlign: "center",
        fontFamily: "Georgia, serif",
        lineHeight: "1.15",
        marginBottom: "24px",
      },
      true,
    ),
    new StyleClass(
      "heading1",
      "Heading 1",
      "h1",
      {
        fontSize: "24px",
        fontWeight: "700",
        color: "#1a1a1a",
        fontFamily: "Georgia, serif",
        lineHeight: "1.25",
        marginBottom: "12px",
        marginTop: "24px",
      },
      true,
    ),
    new StyleClass(
      "heading2",
      "Heading 2",
      "h2",
      {
        fontSize: "19px",
        fontWeight: "700",
        color: "#2d2d2d",
        fontFamily: "Georgia, serif",
        lineHeight: "1.3",
        marginBottom: "10px",
        marginTop: "18px",
      },
      true,
    ),
    new StyleClass(
      "heading3",
      "Heading 3",
      "h3",
      {
        fontSize: "15px",
        fontWeight: "600",
        color: "#2d2d2d",
        fontFamily: "Georgia, serif",
        lineHeight: "1.35",
        marginBottom: "8px",
        marginTop: "14px",
      },
      true,
    ),
    new StyleClass(
      "lead",
      "Lead",
      "p",
      {
        fontSize: "16px",
        fontWeight: "400",
        color: "#2d2d2d",
        fontFamily: "Georgia, serif",
        lineHeight: "1.75",
        marginBottom: "14px",
      },
      true,
    ),
    new StyleClass(
      "body",
      "Body",
      "p",
      {
        fontSize: "13px",
        fontWeight: "400",
        color: "#2d2d2d",
        fontFamily: "Georgia, serif",
        lineHeight: "1.7",
        marginBottom: "10px",
      },
      true,
    ),
    new StyleClass(
      "body-sm",
      "Body Small",
      "p",
      {
        fontSize: "11px",
        fontWeight: "400",
        color: "#555555",
        fontFamily: "Georgia, serif",
        lineHeight: "1.6",
        marginBottom: "8px",
      },
      true,
    ),
    new StyleClass(
      "subtitle",
      "Subtitle",
      "p",
      {
        fontSize: "15px",
        fontStyle: "italic",
        color: "#555555",
        textAlign: "center",
        fontFamily: "Georgia, serif",
        lineHeight: "1.45",
        marginBottom: "18px",
      },
      true,
    ),
    new StyleClass(
      "caption",
      "Caption",
      "figcaption",
      {
        fontSize: "11px",
        fontStyle: "italic",
        color: "#777777",
        textAlign: "center",
        lineHeight: "1.4",
        marginBottom: "6px",
        marginTop: "4px",
      },
      true,
    ),
    new StyleClass(
      "quote",
      "Quote",
      "p",
      {
        fontSize: "14px",
        fontStyle: "italic",
        color: "#555555",
        fontFamily: "Georgia, serif",
        lineHeight: "1.7",
        marginBottom: "14px",
        borderLeft: "2px solid #cccccc",
        paddingLeft: "16px",
      },
      true,
    ),
    new StyleClass(
      "note",
      "Note",
      "p",
      {
        fontSize: "11px",
        fontWeight: "400",
        color: "#555555",
        lineHeight: "1.5",
        marginBottom: "10px",
        border: "1px solid #e5e5e5",
        padding: "6px 10px",
        borderRadius: "2px",
      },
      true,
    ),
    new StyleClass(
      "code",
      "Code",
      "code",
      {
        fontSize: "12px",
        fontFamily: "monospace",
        color: "#b45309",
        backgroundColor: "#fef3c7",
        padding: "2px 5px",
        borderRadius: "2px",
      },
      true,
    ),
    new StyleClass(
      "table-info",
      "Info Table",
      "table",
      {
        fontSize: "12px",
        color: "#2d2d2d",
        lineHeight: "1.5",
        marginBottom: "14px",
        marginTop: "6px",
      },
      true,
    ),
    new StyleClass(
      "footer-text",
      "Footer Text",
      "p",
      {
        fontSize: "10px",
        color: "#555555",
        lineHeight: "1.5",
        marginBottom: "0px",
        marginTop: "0px",
      },
      true,
    ),
    new StyleClass(
      "footer-note",
      "Footer Note",
      "p",
      {
        fontSize: "9px",
        color: "#888888",
        lineHeight: "1.4",
        marginBottom: "0px",
        marginTop: "0px",
      },
      true,
    ),
    new StyleClass(
      "footer-container",
      "Footer Container",
      "hbox",
      {
        marginTop: "20px",
        marginBottom: "6px",
      },
      true,
    ),
    new StyleClass(
      "footer-bar-container",
      "Footer Bar",
      "hbox",
      {
        marginTop: "4px",
        marginBottom: "0px",
        borderTop: "1px solid #cccccc",
        paddingTop: "4px",
      },
      true,
    ),
    new StyleClass(
      "footer-column",
      "Footer Column",
      "vbox",
      {
        flex: "1",
      },
      true,
    ),
  ];
}

// ---------------------------------------------------------------------------
// technical — Consolas/monospace, near-black, tight grid
// ---------------------------------------------------------------------------

function createTechnical(): StyleClass[] {
  const mono = "Consolas, 'JetBrains Mono', monospace";
  return [
    new StyleClass(
      "title",
      "Title",
      "h1",
      {
        fontSize: "20px",
        fontWeight: "700",
        color: "#000000",
        textAlign: "left",
        fontFamily: mono,
        lineHeight: "1.2",
        marginBottom: "16px",
        borderBottom: "2px solid #000000",
        paddingBottom: "6px",
      },
      true,
    ),
    new StyleClass(
      "heading1",
      "Heading 1",
      "h1",
      {
        fontSize: "17px",
        fontWeight: "700",
        color: "#000000",
        fontFamily: mono,
        lineHeight: "1.3",
        marginBottom: "10px",
        marginTop: "20px",
        borderBottom: "1px solid #333333",
        paddingBottom: "4px",
      },
      true,
    ),
    new StyleClass(
      "heading2",
      "Heading 2",
      "h2",
      {
        fontSize: "14px",
        fontWeight: "700",
        color: "#111111",
        fontFamily: mono,
        lineHeight: "1.3",
        marginBottom: "8px",
        marginTop: "16px",
      },
      true,
    ),
    new StyleClass(
      "heading3",
      "Heading 3",
      "h3",
      {
        fontSize: "13px",
        fontWeight: "700",
        color: "#222222",
        fontFamily: mono,
        lineHeight: "1.3",
        marginBottom: "6px",
        marginTop: "12px",
      },
      true,
    ),
    new StyleClass(
      "lead",
      "Lead",
      "p",
      {
        fontSize: "13px",
        fontWeight: "400",
        color: "#111111",
        fontFamily: mono,
        lineHeight: "1.6",
        marginBottom: "12px",
      },
      true,
    ),
    new StyleClass(
      "body",
      "Body",
      "p",
      {
        fontSize: "12px",
        fontWeight: "400",
        color: "#222222",
        fontFamily: mono,
        lineHeight: "1.55",
        marginBottom: "8px",
      },
      true,
    ),
    new StyleClass(
      "body-sm",
      "Body Small",
      "p",
      {
        fontSize: "11px",
        fontWeight: "400",
        color: "#333333",
        fontFamily: mono,
        lineHeight: "1.5",
        marginBottom: "6px",
      },
      true,
    ),
    new StyleClass(
      "subtitle",
      "Subtitle",
      "p",
      {
        fontSize: "13px",
        fontWeight: "400",
        color: "#333333",
        fontFamily: mono,
        lineHeight: "1.4",
        marginBottom: "14px",
      },
      true,
    ),
    new StyleClass(
      "caption",
      "Caption",
      "figcaption",
      {
        fontSize: "10px",
        fontWeight: "400",
        color: "#555555",
        fontFamily: mono,
        textAlign: "center",
        lineHeight: "1.4",
        marginBottom: "4px",
        marginTop: "4px",
      },
      true,
    ),
    new StyleClass(
      "quote",
      "Quote",
      "p",
      {
        fontSize: "12px",
        fontWeight: "400",
        color: "#333333",
        fontFamily: mono,
        lineHeight: "1.55",
        marginBottom: "10px",
        borderLeft: "3px solid #555555",
        paddingLeft: "12px",
        backgroundColor: "#f5f5f5",
      },
      true,
    ),
    new StyleClass(
      "note",
      "Note",
      "p",
      {
        fontSize: "11px",
        fontWeight: "400",
        color: "#333333",
        fontFamily: mono,
        lineHeight: "1.5",
        marginBottom: "8px",
        backgroundColor: "#f0f0f0",
        padding: "6px 10px",
        borderLeft: "2px solid #888888",
      },
      true,
    ),
    new StyleClass(
      "code",
      "Code",
      "code",
      {
        fontSize: "11px",
        fontFamily: "monospace",
        color: "#000000",
        backgroundColor: "#eeeeee",
        padding: "2px 6px",
        borderRadius: "0px",
      },
      true,
    ),
    new StyleClass(
      "table-info",
      "Info Table",
      "table",
      {
        fontSize: "11px",
        color: "#111111",
        lineHeight: "1.4",
        marginBottom: "12px",
        marginTop: "6px",
        fontFamily: mono,
      },
      true,
    ),
    new StyleClass(
      "footer-text",
      "Footer Text",
      "p",
      {
        fontSize: "10px",
        color: "#555555",
        fontFamily: mono,
        lineHeight: "1.4",
        marginBottom: "0px",
        marginTop: "0px",
      },
      true,
    ),
    new StyleClass(
      "footer-note",
      "Footer Note",
      "p",
      {
        fontSize: "9px",
        color: "#888888",
        fontFamily: mono,
        lineHeight: "1.3",
        marginBottom: "0px",
        marginTop: "0px",
      },
      true,
    ),
    new StyleClass(
      "footer-container",
      "Footer Container",
      "hbox",
      {
        marginTop: "16px",
        marginBottom: "6px",
      },
      true,
    ),
    new StyleClass(
      "footer-bar-container",
      "Footer Bar",
      "hbox",
      {
        marginTop: "4px",
        marginBottom: "0px",
        borderTop: "1px solid #888888",
        paddingTop: "4px",
      },
      true,
    ),
    new StyleClass(
      "footer-column",
      "Footer Column",
      "vbox",
      {
        flex: "1",
      },
      true,
    ),
  ];
}

// ---------------------------------------------------------------------------
// minimal — ultra-clean, maximum whitespace, light grays
// ---------------------------------------------------------------------------

function createMinimal(): StyleClass[] {
  return [
    new StyleClass(
      "title",
      "Title",
      "h1",
      {
        fontSize: "28px",
        fontWeight: "300",
        color: "#111111",
        textAlign: "center",
        lineHeight: "1.1",
        marginBottom: "32px",
        letterSpacing: "-0.5px",
      },
      true,
    ),
    new StyleClass(
      "heading1",
      "Heading 1",
      "h1",
      {
        fontSize: "22px",
        fontWeight: "400",
        color: "#111111",
        textAlign: "left",
        lineHeight: "1.2",
        marginBottom: "18px",
        marginTop: "36px",
      },
      true,
    ),
    new StyleClass(
      "heading2",
      "Heading 2",
      "h2",
      {
        fontSize: "17px",
        fontWeight: "400",
        color: "#222222",
        textAlign: "left",
        lineHeight: "1.25",
        marginBottom: "12px",
        marginTop: "28px",
      },
      true,
    ),
    new StyleClass(
      "heading3",
      "Heading 3",
      "h3",
      {
        fontSize: "14px",
        fontWeight: "500",
        color: "#333333",
        textAlign: "left",
        lineHeight: "1.3",
        marginBottom: "10px",
        marginTop: "20px",
      },
      true,
    ),
    new StyleClass(
      "lead",
      "Lead",
      "p",
      {
        fontSize: "16px",
        fontWeight: "300",
        color: "#333333",
        textAlign: "left",
        lineHeight: "1.8",
        marginBottom: "20px",
      },
      true,
    ),
    new StyleClass(
      "body",
      "Body",
      "p",
      {
        fontSize: "14px",
        fontWeight: "400",
        color: "#444444",
        textAlign: "left",
        lineHeight: "1.75",
        marginBottom: "16px",
      },
      true,
    ),
    new StyleClass(
      "body-sm",
      "Body Small",
      "p",
      {
        fontSize: "12px",
        fontWeight: "400",
        color: "#666666",
        textAlign: "left",
        lineHeight: "1.65",
        marginBottom: "10px",
      },
      true,
    ),
    new StyleClass(
      "subtitle",
      "Subtitle",
      "p",
      {
        fontSize: "15px",
        fontWeight: "300",
        color: "#888888",
        textAlign: "center",
        lineHeight: "1.5",
        marginBottom: "28px",
        letterSpacing: "0.3px",
      },
      true,
    ),
    new StyleClass(
      "caption",
      "Caption",
      "figcaption",
      {
        fontSize: "11px",
        fontWeight: "400",
        color: "#aaaaaa",
        textAlign: "center",
        lineHeight: "1.4",
        marginBottom: "8px",
        marginTop: "6px",
      },
      true,
    ),
    new StyleClass(
      "quote",
      "Quote",
      "p",
      {
        fontSize: "15px",
        fontWeight: "300",
        color: "#555555",
        textAlign: "left",
        lineHeight: "1.75",
        marginBottom: "18px",
        borderLeft: "1px solid #cccccc",
        paddingLeft: "20px",
      },
      true,
    ),
    new StyleClass(
      "note",
      "Note",
      "p",
      {
        fontSize: "12px",
        fontWeight: "400",
        color: "#666666",
        textAlign: "left",
        lineHeight: "1.6",
        marginBottom: "14px",
        borderBottom: "1px solid #eeeeee",
        paddingBottom: "10px",
      },
      true,
    ),
    new StyleClass(
      "code",
      "Code",
      "code",
      {
        fontSize: "12px",
        fontFamily: "monospace",
        color: "#555555",
        backgroundColor: "#f9f9f9",
        padding: "2px 6px",
        borderRadius: "2px",
      },
      true,
    ),
    new StyleClass(
      "table-info",
      "Info Table",
      "table",
      {
        fontSize: "13px",
        color: "#333333",
        lineHeight: "1.6",
        marginBottom: "20px",
        marginTop: "12px",
      },
      true,
    ),
    new StyleClass(
      "footer-text",
      "Footer Text",
      "p",
      {
        fontSize: "11px",
        color: "#aaaaaa",
        lineHeight: "1.5",
        marginBottom: "0px",
        marginTop: "0px",
      },
      true,
    ),
    new StyleClass(
      "footer-note",
      "Footer Note",
      "p",
      {
        fontSize: "10px",
        color: "#cccccc",
        lineHeight: "1.4",
        marginBottom: "0px",
        marginTop: "0px",
      },
      true,
    ),
    new StyleClass(
      "footer-container",
      "Footer Container",
      "hbox",
      {
        marginTop: "28px",
        marginBottom: "8px",
      },
      true,
    ),
    new StyleClass(
      "footer-bar-container",
      "Footer Bar",
      "hbox",
      {
        marginTop: "6px",
        marginBottom: "0px",
        borderTop: "1px solid #eeeeee",
        paddingTop: "6px",
      },
      true,
    ),
    new StyleClass(
      "footer-column",
      "Footer Column",
      "vbox",
      {
        flex: "1",
      },
      true,
    ),
  ];
}
