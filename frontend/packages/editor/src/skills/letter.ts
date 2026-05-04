import type { Skill } from "../models/skill";

export const letterSkill: Skill = {
  id: "letter",
  name: "Letter",
  description: "Formal or business letter with standard letter structure.",
  triggers: ["letter", "correspondence", "dear", "formal", "write to", "resign", "complaint", "cover letter"],
  od: {
    mode: "letter",
    platform: "pdf",
    scenario: "correspondence",
    design_system: { requires: false },
    example_prompt: "A formal resignation letter to a manager — two paragraphs, professional tone, two weeks notice.",
  },
  instructions: `
Produce letters in the standard formal letter format using only single-column, left-aligned blocks.
Output blocks in this exact order:
1. Sender name and address — one p block per line (name, street, city/postcode, email).
2. Date — one p block (e.g. "15 January 2025").
3. Recipient name, title, company, address — one p block per line.
4. Subject line — h3 (e.g. "Re: Resignation Notice").
5. Salutation — p starting with "Dear [Name]," or "Dear Sir/Madam,".
6. Body paragraphs — one p per paragraph; keep to 2–4 paragraphs.
7. Closing line — p (e.g. "Yours sincerely," or "Kind regards,").
8. Sender name (signature line) — p (just the name).

Rules:
- Never use multi-column tables for letter layout.
- Never add decorative hr between letter elements.
- Keep each element as its own block so the user can edit independently.
`.trim(),
};
