export interface SkillDesignSystem {
  requires: boolean;
  /** Optional list of token names the skill relies on (informational). */
  tokens?: string[];
}

export interface SkillPreview {
  type: "html";
  /** Path to an example HTML file, relative to the skill folder. */
  entry: string;
}

export interface SkillOd {
  /** Primary output / interaction mode. */
  mode: "document" | "letter" | "invoice" | "timetable" | "image" | (string & {});
  /** Target rendering surface. */
  platform?: "pdf" | "web" | "print" | (string & {});
  /** Use-case label for display / tooling. */
  scenario?: string;
  design_system?: SkillDesignSystem;
  /** Canned example shown in skill docs / picker. */
  example_prompt?: string;
  preview?: SkillPreview;
}

export interface Skill {
  /** Unique, URL-safe identifier — used as the <option value>. */
  id: string;
  /** Human-readable display name shown in the UI picker. */
  name: string;
  /** One-sentence description shown as a tooltip / hint. */
  description: string;
  /** Keywords that can be used for auto-suggest in future. */
  triggers?: string[];
  /** Extended od: frontmatter block. */
  od: SkillOd;
  /**
   * Domain-specific guidance injected into the LM system prompt above the
   * style catalog.  Mirrors the body of a SKILL.md file.
   */
  instructions: string;
}

/**
 * Lean projection of Skill used by lm-prompt-builder so it doesn't need to
 * import the full Skill type.
 */
export interface SkillContext {
  id: string;
  name: string;
  instructions: string;
}
