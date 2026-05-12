export type WorkspaceContext = "compose" | "layout" | "review" | "stats" | "nlp" | "export";

export const WORKSPACE_CONTEXTS: WorkspaceContext[] = ["compose", "layout", "review", "stats", "nlp", "export"];

export interface WorkspaceContextMeta {
  id: WorkspaceContext;
  label: string;
  icon: string;
  description: string;
  shortcut?: string;
}

export const WORKSPACE_CONTEXT_META: Record<WorkspaceContext, WorkspaceContextMeta> = {
  compose: {
    id: "compose",
    label: "Compose",
    icon: "pencil",
    description: "Flow-first writing with inline block actions beside the active block",
    shortcut: "⌘1",
  },
  layout: {
    id: "layout",
    label: "Layout",
    icon: "layout",
    description: "Full workspace with block tree, styles, and properties",
    shortcut: "⌘2",
  },
  review: {
    id: "review",
    label: "Review",
    icon: "eye",
    description: "Read-only preview with annotations and comments",
    shortcut: "⌘3",
  },
  stats: {
    id: "stats",
    label: "Stats",
    icon: "chart-bar",
    description: "Document statistics: readability, word frequency, structure",
    shortcut: "⌘4",
  },
  nlp: {
    id: "nlp",
    label: "NLP",
    icon: "tag",
    description: "Interactive token inspection with POS, entities, keywords, and token details",
    shortcut: "⌘5",
  },
  export: {
    id: "export",
    label: "Export",
    icon: "download",
    description: "Save the document and export via print CSS, HTML, Markdown, or AsciiDoc",
    shortcut: "⌘6",
  },
};

export type DocumentIntent = "freeform" | "letter" | "invitation" | "invoice" | "webpage" | "book" | "notes" | "cv" | "report" | "presentation";

export interface DocumentIntentMeta {
  id: DocumentIntent;
  label: string;
  icon: string;
  description: string;
  defaultSkill: string;
  defaultTheme: "modern" | "classic" | "technical" | "minimal";
  defaultPageSize: "a4" | "letter" | "a5";
  paginatedOutput: boolean;
}

export const DOCUMENT_INTENT_META: Record<DocumentIntent, DocumentIntentMeta> = {
  freeform: {
    id: "freeform",
    label: "Freeform",
    icon: "file",
    description: "No template — blank slate",
    defaultSkill: "document",
    defaultTheme: "modern",
    defaultPageSize: "a4",
    paginatedOutput: true,
  },
  letter: {
    id: "letter",
    label: "Letter",
    icon: "mail",
    description: "Formal letter with recipient, body, and signature",
    defaultSkill: "letter",
    defaultTheme: "classic",
    defaultPageSize: "a4",
    paginatedOutput: true,
  },
  invitation: {
    id: "invitation",
    label: "Invitation",
    icon: "calendar",
    description: "Event invitation with date, time, location, and RSVP",
    defaultSkill: "document",
    defaultTheme: "modern",
    defaultPageSize: "a5",
    paginatedOutput: true,
  },
  invoice: {
    id: "invoice",
    label: "Invoice",
    icon: "receipt",
    description: "Invoice with line items, totals, and payment details",
    defaultSkill: "invoice",
    defaultTheme: "technical",
    defaultPageSize: "a4",
    paginatedOutput: true,
  },
  webpage: {
    id: "webpage",
    label: "Web Page",
    icon: "globe",
    description: "HTML-first output: sections, media, calls-to-action",
    defaultSkill: "document",
    defaultTheme: "modern",
    defaultPageSize: "a4",
    paginatedOutput: false,
  },
  book: {
    id: "book",
    label: "Book",
    icon: "book-open",
    description: "Long-form document with chapters, sections, and footnotes",
    defaultSkill: "document",
    defaultTheme: "classic",
    defaultPageSize: "a5",
    paginatedOutput: true,
  },
  notes: {
    id: "notes",
    label: "Notes",
    icon: "sticky-note",
    description: "Fast note-taking: headings, bullets, code blocks",
    defaultSkill: "document",
    defaultTheme: "minimal",
    defaultPageSize: "a4",
    paginatedOutput: false,
  },
  cv: {
    id: "cv",
    label: "CV / Résumé",
    icon: "id-card",
    description: "Curriculum vitae with contact, experience, education",
    defaultSkill: "document",
    defaultTheme: "modern",
    defaultPageSize: "a4",
    paginatedOutput: true,
  },
  report: {
    id: "report",
    label: "Report",
    icon: "file-text",
    description: "Structured report with summary, findings, and appendix",
    defaultSkill: "document",
    defaultTheme: "technical",
    defaultPageSize: "a4",
    paginatedOutput: true,
  },
  presentation: {
    id: "presentation",
    label: "Presentation",
    icon: "presentation",
    description: "Slide-like pages, one topic per page",
    defaultSkill: "document",
    defaultTheme: "modern",
    defaultPageSize: "a4",
    paginatedOutput: true,
  },
};

export interface NLPVisibilityFlags {
  showPOS: boolean;
  showNER: boolean;
  showKeywords: boolean;
  showSpellErrors: boolean;
  showReadability: boolean;
  showSentiment: boolean;
  showSynonyms: boolean;
  showDepTree: boolean;
}

export const DEFAULT_NLP_FLAGS: NLPVisibilityFlags = {
  showPOS:         false,   // requires nlp_pos C++ binding — not yet registered
  showNER:         true,
  showKeywords: true,
  showSpellErrors: true,
  showReadability: false,
  showSentiment: false,
  showSynonyms: true,
  showDepTree: false,
};
