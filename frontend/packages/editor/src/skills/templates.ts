/**
 * @file skills/templates.ts
 * Built-in document templates — each produces a ready-to-edit SDocument.
 *
 * Templates are pure factories: they never call IPC or touch the store.
 * Callers dispatch LOAD_DOCUMENT with the result.
 */

import { createDocument } from "../models/sdm-factory";
import type {
  SBlock, STextBlock, SListBlock, SHBoxBlock, SVBoxBlock, SColBlock,
  STableBlock, STrBlock, SCalloutBlock, SHrBlock,
  SpacingToken, CalloutVariant, PageSize,
  SDocument, SStyleProps,
} from "../models/sdm";

// ── tiny block-construction helpers ──────────────────────────────────────────

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** Build a Span array from a plain string. */
function sp(text: string) { return [{ text }]; }

/** Text block (p, h1-h4, li, td, th, quote, figcaption). */
function tb(type: STextBlock["type"], text: string, style?: string): STextBlock {
  return { id: uid(), type, spans: sp(text), ...(style ? { style } : {}) } as STextBlock;
}

function h1(t: string, style?: string) { return tb("h1", t, style); }
function h2(t: string, style?: string) { return tb("h2", t, style); }
function h3(t: string, style?: string) { return tb("h3", t, style); }
function p(t: string, style?: string)  { return tb("p",  t, style); }

function ul(items: string[], style?: string): SListBlock {
  return {
    id: uid(), type: "ul",
    children: items.map(i => tb("li", i, style)),
  };
}

function ol(items: string[]): SListBlock {
  return { id: uid(), type: "ol", children: items.map(i => tb("li", i)) };
}

function hr(): SHrBlock { return { id: uid(), type: "hr" }; }

function col(children: SBlock[], width?: string, style?: string): SColBlock {
  return { id: uid(), type: "col", ...(width ? { width } : {}), children, ...(style ? { style } : {}) };
}

function hbox(cols: SColBlock[], gap: SpacingToken = "md"): SHBoxBlock {
  return { id: uid(), type: "hbox", gap, children: cols };
}

function vbox(children: SBlock[], gap: SpacingToken = "sm"): SVBoxBlock {
  return { id: uid(), type: "vbox", gap, children };
}

function th(text: string): STextBlock & { type: "th" } {
  return { id: uid(), type: "th", spans: sp(text) } as STextBlock & { type: "th" };
}
function td(text: string): STextBlock & { type: "td" } {
  return { id: uid(), type: "td", spans: sp(text) } as STextBlock & { type: "td" };
}
function tr(cells: string[], header = false): STrBlock {
  return { id: uid(), type: "tr", children: cells.map(c => header ? th(c) : td(c)) };
}
function table(head: string[], ...rows: string[][]): STableBlock {
  return { id: uid(), type: "table", children: [tr(head, true), ...rows.map(r => tr(r))] };
}

function callout(variant: CalloutVariant, title: string, body: string): SCalloutBlock {
  return { id: uid(), type: "callout", variant, title, children: [p(body)] };
}

function cls(props: SStyleProps) { return { props }; }

// ── Template metadata + factory ───────────────────────────────────────────────

export interface DocumentTemplate {
  id:          string;
  name:        string;
  description: string;
  /** Unicode emoji used as the template icon in the grid. */
  emoji:       string;
  category:    "general" | "business" | "personal" | "technical";
  create():    SDocument;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Freeform — blank slate
// ─────────────────────────────────────────────────────────────────────────────
const freeform: DocumentTemplate = {
  id: "freeform", name: "Freeform", emoji: "📝",
  description: "Blank A4 — write anything",
  category: "general",
  create() {
    return createDocument({ title: "" });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Letter — personal correspondence, paper feel
// ─────────────────────────────────────────────────────────────────────────────
const letter: DocumentTemplate = {
  id: "letter", name: "Letter", emoji: "✉️",
  description: "Personal letter — classic paper layout",
  category: "personal",
  create() {
    const doc = createDocument({ title: "Personal Letter" });
    doc.styles = {
      "meta":  cls({ size: "sm", color: "#6b7280", font: "sans" }),
      "body":  cls({ font: "serif", leading: "relaxed", size: "md" }),
      "sign":  cls({ font: "serif", style: "italic" }),
    };
    doc.blocks = [
      // Sender address (top-right feel — overrides align)
      p("Your Name",    "meta"),
      p("Street Address, City, ZIP", "meta"),
      p("your@email.com", "meta"),
      hr(),
      p(new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" }), "meta"),
      hr(),
      // Recipient
      p("Recipient Name",    "meta"),
      p("Recipient Address", "meta"),
      hr(),
      // Salutation + body
      p("Dear [Name],", "body"),
      p("I am writing to you regarding …", "body"),
      p("Please feel free to reach out if you have any questions.", "body"),
      // Closing
      p("Yours sincerely,", "body"),
      hr(),
      p("Your Name", "sign"),
    ];
    return doc;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Invitation
// ─────────────────────────────────────────────────────────────────────────────
const invitation: DocumentTemplate = {
  id: "invitation", name: "Invitation", emoji: "🎉",
  description: "Event card — centered, elegant",
  category: "personal",
  create() {
    const doc = createDocument({ title: "Event Invitation" });
    doc.page = { ...doc.page, size: "a5", margin: "lg" };
    doc.styles = {
      "title":  cls({ font: "serif", size: "3xl", weight: "bold", align: "center" }),
      "sub":    cls({ font: "serif", style: "italic", align: "center", color: "#6b7280" }),
      "detail": cls({ font: "sans", size: "sm", align: "center", leading: "relaxed" }),
      "rsvp":   cls({ font: "sans", size: "xs", align: "center", weight: "semibold", tracking: "wide" }),
    };
    doc.blocks = [
      h1("You're Invited!", "title"),
      p("Join us for a special occasion", "sub"),
      hr(),
      p("📅  Saturday, 15 February 2025", "detail"),
      p("⏰  7:00 PM – Midnight", "detail"),
      p("📍  The Grand Ballroom, 123 Main Street", "detail"),
      hr(),
      p("RSVP by 1 February · events@example.com", "rsvp"),
    ];
    return doc;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Invoice — with line-item table + totals
//    (data_source CSV can be wired later via SDataSource)
// ─────────────────────────────────────────────────────────────────────────────
const invoice: DocumentTemplate = {
  id: "invoice", name: "Invoice", emoji: "🧾",
  description: "Professional invoice with line-item table",
  category: "business",
  create() {
    const doc = createDocument({ title: "Invoice" });
    doc.styles = {
      "inv-title": cls({ font: "sans", size: "4xl", weight: "bold", tracking: "tight" }),
      "inv-meta":  cls({ font: "mono", size: "sm", color: "#6b7280" }),
      "inv-label": cls({ font: "sans", size: "xs", weight: "semibold", tracking: "wide", color: "#9ca3af" }),
      "total":     cls({ font: "sans", weight: "bold", size: "lg" }),
    };
    doc.blocks = [
      // Header row: company ↔ invoice meta
      hbox([
        col([
          h1("INVOICE", "inv-title"),
          p("Your Company Name", "inv-meta"),
          p("123 Business Street, City", "inv-meta"),
          p("VAT / Tax ID: DE000000000", "inv-meta"),
        ], "55%"),
        col([
          p("Invoice #", "inv-label"),
          p("INV-2025-001", "inv-meta"),
          p("Date", "inv-label"),
          p(new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" }), "inv-meta"),
          p("Due date", "inv-label"),
          p("Net 30", "inv-meta"),
        ], "45%"),
      ]),
      hr(),
      // Bill-to
      p("Bill To", "inv-label"),
      p("Client Name"),
      p("Client Address"),
      hr(),
      // Line items
      table(
        ["Description", "Qty", "Unit Price", "Amount"],
        ["Service Item A", "1", "€ 1,200.00", "€ 1,200.00"],
        ["Service Item B", "3", "€ 450.00",   "€ 1,350.00"],
        ["Expenses",       "1", "€ 85.00",    "€ 85.00"],
      ),
      hr(),
      // Totals (right-aligned block)
      hbox([
        col([], "60%"),
        col([
          p("Subtotal: € 2,635.00", "inv-meta"),
          p("Tax (19 %): € 500.65", "inv-meta"),
          p("Total Due: € 3,135.65", "total"),
        ], "40%"),
      ]),
      hr(),
      p("Payment Terms: Net 30. Bank transfer to IBAN DE00 0000 0000 0000."),
    ];
    return doc;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Technical Report — blueprint / engineering desk feel
//    showPageNumbers on, monospace section markers
// ─────────────────────────────────────────────────────────────────────────────
const technicalReport: DocumentTemplate = {
  id: "technical-report", name: "Technical Report", emoji: "🔬",
  description: "Sections, code blocks, numbered pages",
  category: "technical",
  create() {
    const doc = createDocument({ title: "Technical Report" });
    doc.page = { ...doc.page, showPageNumbers: true };
    doc.styles = {
      "abstract":  cls({ font: "serif", leading: "relaxed", size: "sm", color: "#374151" }),
      "section-h": cls({ font: "mono", weight: "bold", tracking: "tight", size: "lg" }),
      "caption":   cls({ font: "sans", size: "xs", color: "#6b7280", style: "italic" }),
    };
    doc.blocks = [
      h1("Technical Report Title"),
      p("Author · Organisation · " + new Date().getFullYear().toString(), "caption"),
      hr(),
      h2("Abstract", "section-h"),
      p("This report presents …", "abstract"),
      hr(),
      h2("1  Introduction", "section-h"),
      p("Background and motivation for this work …"),
      h2("2  Methodology", "section-h"),
      p("The following approach was used:"),
      ul(["Step one: define parameters", "Step two: execute pipeline", "Step three: evaluate results"]),
      h2("3  Implementation", "section-h"),
      p("Key implementation excerpt:"),
      { id: uid(), type: "code" as const, language: "python",
        text: "def process(data):\n    result = transform(data)\n    return validate(result)" } satisfies SBlock,
      h2("4  Results", "section-h"),
      callout("success", "Key result", "The measured throughput exceeded baseline by 42 %."),
      p("Detailed analysis …"),
      h2("5  Conclusion", "section-h"),
      p("Summary of findings and future work …"),
      hr(),
      h2("References", "section-h"),
      ol([
        "Author A (2024). Title. Journal of …",
        "Author B (2023). Another reference. Conference on …",
      ]),
    ];
    return doc;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. Report — business / data report, charts-friendly
// ─────────────────────────────────────────────────────────────────────────────
const report: DocumentTemplate = {
  id: "report", name: "Report", emoji: "📊",
  description: "Executive summary, KPIs, findings",
  category: "business",
  create() {
    const doc = createDocument({ title: "Quarterly Report" });
    doc.page = { ...doc.page, showPageNumbers: true };
    doc.styles = {
      "kpi-label": cls({ font: "sans", size: "xs", weight: "semibold", tracking: "wide", color: "#9ca3af" }),
      "kpi-value": cls({ font: "sans", size: "4xl", weight: "bold" }),
      "section-h": cls({ font: "sans", weight: "bold", size: "xl", tracking: "tight" }),
    };
    doc.blocks = [
      h1("Q4 2024 Report"),
      p("Prepared by Finance & Operations · " + new Date().getFullYear().toString()),
      hr(),
      // KPI strip
      hbox([
        col([p("Revenue", "kpi-label"), p("€ 1.2M", "kpi-value")], "33%"),
        col([p("Growth",  "kpi-label"), p("+18 %",  "kpi-value")], "33%"),
        col([p("NPS",     "kpi-label"), p("72",     "kpi-value")], "34%"),
      ], "lg"),
      hr(),
      h2("Executive Summary", "section-h"),
      p("This quarter saw continued growth across all business units …"),
      h2("Key Findings", "section-h"),
      callout("info",    "Market",      "Expansion in DACH region exceeded targets by 22 %."),
      callout("warning", "Ops",         "Supply-chain delays impacted Q4 delivery SLAs."),
      callout("success", "Engineering", "Platform migration completed on schedule."),
      h2("Recommendations", "section-h"),
      ol([
        "Prioritise supply-chain resilience initiatives for Q1.",
        "Accelerate DACH go-to-market investment.",
        "Continue platform modernisation roadmap.",
      ]),
      hr(),
      h2("Appendix", "section-h"),
      table(
        ["Business Unit", "Q3", "Q4", "Δ"],
        ["Products",  "€ 520k", "€ 630k", "+21 %"],
        ["Services",  "€ 310k", "€ 380k", "+23 %"],
        ["Licensing", "€ 175k", "€ 190k", "+9 %"],
      ),
    ];
    return doc;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. CV / Résumé — two-column: slim sidebar + main content
// ─────────────────────────────────────────────────────────────────────────────
const cv: DocumentTemplate = {
  id: "cv", name: "CV / Résumé", emoji: "👤",
  description: "Two-column — contact, skills, experience",
  category: "personal",
  create() {
    const doc = createDocument({ title: "Curriculum Vitae" });
    doc.page = { ...doc.page, margin: "sm" };
    doc.styles = {
      "cv-name":    cls({ font: "sans", size: "3xl", weight: "bold" }),
      "cv-title":   cls({ font: "sans", size: "lg",  color: "#6b7280", style: "italic" }),
      "cv-label":   cls({ font: "sans", size: "xs",  weight: "semibold", tracking: "wide", color: "#9ca3af" }),
      "cv-section": cls({ font: "sans", size: "md",  weight: "bold", tracking: "tight" }),
      "cv-meta":    cls({ font: "sans", size: "xs",  color: "#6b7280" }),
    };
    // Sidebar content
    const sidebar: SBlock[] = [
      p("CONTACT", "cv-label"),
      p("city@example.com"),
      p("+49 123 456 789"),
      p("linkedin.com/in/yourname"),
      p("github.com/yourhandle"),
      hr(),
      p("SKILLS", "cv-label"),
      ul(["TypeScript / React", "Rust / C++", "SQL / SQLite", "CI/CD · Docker"]),
      hr(),
      p("LANGUAGES", "cv-label"),
      ul(["English — fluent", "German — native", "Greek — conversational"]),
    ];
    // Main content
    const main: SBlock[] = [
      h1("Full Name", "cv-name"),
      p("Senior Software Engineer", "cv-title"),
      hr(),
      h2("Experience", "cv-section"),
      vbox([
        hbox([
          col([h3("Senior Engineer — Acme Corp")], "70%"),
          col([p("2022 – present", "cv-meta")], "30%"),
        ], "sm"),
        p("Led platform migration; reduced build times by 60 %."),
      ], "xs"),
      vbox([
        hbox([
          col([h3("Engineer — Beta Ltd")], "70%"),
          col([p("2019 – 2022", "cv-meta")], "30%"),
        ], "sm"),
        p("Built real-time data pipeline processing 50 M events/day."),
      ], "xs"),
      hr(),
      h2("Education", "cv-section"),
      hbox([
        col([h3("M.Sc. Computer Science — TU Berlin")], "70%"),
        col([p("2017 – 2019", "cv-meta")], "30%"),
      ], "sm"),
      hbox([
        col([h3("B.Sc. Mathematics — Uni Vienna")], "70%"),
        col([p("2013 – 2017", "cv-meta")], "30%"),
      ], "sm"),
      hr(),
      p("References available upon request.", "cv-meta"),
    ];
    doc.blocks = [
      hbox([
        col(sidebar, "32%"),
        col(main,    "68%"),
      ], "lg"),
    ];
    return doc;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Public registry
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATES: DocumentTemplate[] = [
  freeform, letter, invitation, invoice, technicalReport, report, cv,
];

export const TEMPLATE_MAP = new Map<string, DocumentTemplate>(
  TEMPLATES.map(t => [t.id, t]),
);
