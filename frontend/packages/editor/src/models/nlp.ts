export const POS_GROUPS = {
  noun: ["NN", "NNS", "NNP", "NNPS"],
  verb: ["VB", "VBD", "VBG", "VBN", "VBP", "VBZ"],
  adj: ["JJ", "JJR", "JJS"],
  adv: ["RB", "RBR", "RBS"],
  prep: ["IN"],
  det: ["DT"],
  conj: ["CC"],
  pron: ["PRP", "PRP$", "WP", "WDT"],
  num: ["CD"],
  modal: ["MD"],
  punct: [",", ".", ":", "(", ")", "``", "''", "''", "--"],
} as const;

export type POSTag = string;

export type NERType =
  | "PERSON"
  | "ORG"
  | "GPE" // geopolitical entity
  | "LOC" // generic location
  | "DATE"
  | "TIME"
  | "MONEY"
  | "PERCENT"
  | "PRODUCT"
  | "EVENT"
  | "WORK_OF_ART"
  | "LAW"
  | "LANGUAGE"
  | "FAC" // facility
  | "NORP" // nationality, religious group
  | (string & {}); // fallback for custom types

export interface NLPToken {
  text: string;
  whitespaceAfter?: string;
  pos?: POSTag; // Penn Treebank tag
  ner?: NERType;
  isKeyword?: boolean;
  keywordScore?: number;
  lemma?: string;
  synonyms?: string[];
  vectorDistance?: number;
  similarity?: number;
  depRel?: string;
  depHead?: number; // index of head token, -1 = root
  sentiment?: "pos" | "neg" | "neu";
  spellError?: boolean;
  suggestion?: string;
  userHighlight?: string;
  userNote?: string;
}

export interface BlockReadability {
  fleschKincaidGrade: number;
  readabilityScore: number;
  complexity: string;
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  suggestions: string[];
}

export interface SentenceBoundary {
  start: number;
  end: number;
}

export interface NLPBlockAnnotation {
  tokens: NLPToken[];
  sentences?: SentenceBoundary[];
  readability?: BlockReadability;
  lang?: string;
  model?: string;
  analyzedAt: number;
}

export interface DocumentNLPSummary {
  wordCount: number;
  sentenceCount: number;
  keywordCount: number;
  topKeywords: Array<{ term: string; score: number; frequency: number }>;
  entities: Array<{ text: string; type: NERType; count: number }>;
  avgGrade: number;
  readabilityScore: number;
  language?: string;
  posDistribution?: Record<string, number>;
  computedAt: number;
}

export interface NLPAnalysisRequest {
  text: string;
  lang?: string;
  options: {
    pos?: boolean;
    ner?: boolean;
    keywords?: boolean;
    readability?: boolean;
    spellCheck?: boolean;
    synonyms?: boolean;
  };
}

export const POS_COLORS: Record<string, string> = {
  // Nouns — blue family
  NN: "hsl(210,70%,88%)",
  NNS: "hsl(210,70%,88%)",
  NNP: "hsl(225,75%,85%)",
  NNPS: "hsl(225,75%,85%)",
  // Verbs — green family
  VB: "hsl(130,60%,87%)",
  VBD: "hsl(130,60%,87%)",
  VBG: "hsl(145,65%,85%)",
  VBN: "hsl(145,65%,85%)",
  VBP: "hsl(130,60%,87%)",
  VBZ: "hsl(130,60%,87%)",
  // Adjectives — amber family
  JJ: "hsl( 44,90%,84%)",
  JJR: "hsl( 44,90%,84%)",
  JJS: "hsl( 44,90%,84%)",
  // Adverbs — orange family
  RB: "hsl( 28,85%,85%)",
  RBR: "hsl( 28,85%,85%)",
  RBS: "hsl( 28,85%,85%)",
  // Prepositions — purple family
  IN: "hsl(280,50%,88%)",
  // Pronouns — teal family
  PRP: "hsl(175,55%,84%)",
  PRP$: "hsl(175,55%,84%)",
  // Determiners — subtle grey-blue
  DT: "hsl(210,20%,90%)",
  // Conjunctions — pink family
  CC: "hsl(340,60%,88%)",
  // Modal — rose
  MD: "hsl(355,65%,87%)",
  // Numbers — lime
  CD: "hsl( 80,60%,84%)",
};

export function posColor(tag: POSTag | undefined): string | undefined {
  if (!tag) return undefined;
  return POS_COLORS[tag];
}

export function posLabel(tag: POSTag | undefined): string {
  if (!tag) return "";
  const labels: Record<string, string> = {
    NN: "noun",
    NNS: "noun·pl",
    NNP: "proper",
    NNPS: "proper·pl",
    VB: "verb",
    VBD: "verb·past",
    VBG: "verb·ing",
    VBN: "verb·pp",
    VBP: "verb·pres",
    VBZ: "verb·3sg",
    JJ: "adj",
    JJR: "adj·cmp",
    JJS: "adj·sup",
    RB: "adv",
    RBR: "adv·cmp",
    RBS: "adv·sup",
    IN: "prep",
    DT: "det",
    CC: "conj",
    CD: "num",
    PRP: "pron",
    PRP$: "pron·pos",
    WP: "wh-pron",
    WDT: "wh-det",
    MD: "modal",
    TO: "to",
    UH: "interj",
  };
  return labels[tag] ?? tag;
}

export const NER_COLORS: Record<string, string> = {
  PERSON: "hsl(340,75%,84%)",
  ORG: "hsl( 30,80%,83%)",
  GPE: "hsl(200,70%,83%)",
  LOC: "hsl(160,65%,83%)",
  DATE: "hsl(270,55%,85%)",
  TIME: "hsl(270,55%,85%)",
  MONEY: "hsl( 80,65%,82%)",
  PERCENT: "hsl( 80,65%,82%)",
  PRODUCT: "hsl( 45,80%,82%)",
  EVENT: "hsl( 15,75%,83%)",
  WORK_OF_ART: "hsl(310,60%,85%)",
  LAW: "hsl(210,60%,85%)",
  LANGUAGE: "hsl(120,55%,83%)",
  FAC: "hsl(190,65%,83%)",
  NORP: "hsl(355,70%,84%)",
};
