import type { Skill } from "../models/skill";

export const documentSkill: Skill = {
  id: "document",
  name: "Document",
  description: "General-purpose document — headings, paragraphs, lists, tables.",
  triggers: ["document", "report", "write", "create", "draft", "summary"],
  od: {
    mode: "document",
    platform: "pdf",
    scenario: "general",
    design_system: { requires: false },
    example_prompt: "A two-page project report with an executive summary, key findings, and a recommendations table.",
  },
  instructions: `
Produce well-structured documents suitable for PDF export.
Layout guidance:
- Use h1 for the document title (one per document).
- Use h2 for major sections, h3 for subsections.
- Use p for prose paragraphs — one idea per paragraph.
- Use ul/ol for lists; keep list items concise.
- Use table for structured data (always include a header row with th elements).
- Use hr as a section divider sparingly.
`.trim(),
};
