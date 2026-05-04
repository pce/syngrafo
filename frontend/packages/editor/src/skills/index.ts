import type { Skill } from "../models/skill";
import { documentSkill } from "./document";
import { letterSkill } from "./letter";
import { invoiceSkill } from "./invoice";
import { webpageSkill } from "./webpage";

export { documentSkill, letterSkill, invoiceSkill, webpageSkill };

/** Ordered list of all available skills — drives the picker. */
export const ALL_SKILLS: Skill[] = [documentSkill, letterSkill, invoiceSkill, webpageSkill];

/** Fast lookup by id. */
export const SKILL_MAP = new Map<string, Skill>(ALL_SKILLS.map((s) => [s.id, s]));

/** Id of the skill selected when no preference has been saved. */
export const DEFAULT_SKILL_ID = "document";
