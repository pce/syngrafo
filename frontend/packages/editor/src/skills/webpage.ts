import type { Skill } from "../models/skill";

export const webpageSkill: Skill = {
  id: "webpage",
  name: "Web Page",
  description: "Generate clean semantic HTML for a webpage section",
  triggers: ["webpage", "html", "web", "landing"],
  od: {
    mode: "document",
    platform: "web",
    scenario: "web-content",
    design_system: { requires: false },
    example_prompt: "Write a hero section for a design studio portfolio",
  },
  instructions: `
You are writing HTML for a live webpage, not a PDF.
Use semantic HTML5 elements: <section>, <article>, <header>, <footer>, <nav>, <main>, <aside>.
The reveal block (data-block-type="reveal") can show before/after comparisons.
Use clean, accessible markup. Every image must have a meaningful alt attribute.
Avoid inline styles. Use class= attributes from the style catalog.
For calls-to-action, use a <p class="lead"> followed by appropriate text.
`.trim(),
};
