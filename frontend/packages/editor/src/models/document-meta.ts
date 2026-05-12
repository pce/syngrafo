import type { SDocument } from "./sdm";

function trimText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function getDocumentPathStem(path: string | null | undefined): string {
  const trimmed = trimText(path);
  if (!trimmed) return "";
  const leaf = trimmed.split(/[\\/]/).pop() ?? "";
  return leaf.replace(/\.[^.]+$/, "").trim();
}

export function slugifyDocumentFilename(value: string | null | undefined): string {
  return trimText(value)
    .toLowerCase()
    .replace(/[äàáâãåæ]/g, "a")
    .replace(/[öòóôõø]/g, "o")
    .replace(/[üùúû]/g, "u")
    .replace(/[ëèéê]/g, "e")
    .replace(/[ïìíî]/g, "i")
    .replace(/[ýÿ]/g, "y")
    .replace(/ß/g, "ss")
    .replace(/ñ/g, "n")
    .replace(/ç/g, "c")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function filenameToTitle(value: string): string {
  return value.replace(/[-_]+/g, " ").trim();
}

export function getDocumentDisplayTitle(
  doc: Pick<SDocument, "meta"> | null | undefined,
  path?: string | null,
): string {
  const title = trimText(doc?.meta.title);
  if (title) return title;

  const filename = trimText(doc?.meta.filename);
  if (filename) return filenameToTitle(filename);

  const stem = getDocumentPathStem(path);
  if (stem) return filenameToTitle(stem);

  return "New document";
}

export function getDocumentBaseName(
  doc: Pick<SDocument, "meta"> | null | undefined,
  path?: string | null,
): string {
  const filename = slugifyDocumentFilename(doc?.meta.filename);
  if (filename) return filename;

  const title = slugifyDocumentFilename(doc?.meta.title);
  if (title) return title;

  const stem = slugifyDocumentFilename(getDocumentPathStem(path));
  if (stem) return stem;

  return "document";
}

export function normalizeDocumentMetadata(doc: SDocument, path?: string | null): SDocument {
  const title = trimText(doc.meta.title);
  const filename = slugifyDocumentFilename(doc.meta.filename);
  const pathStem = getDocumentPathStem(path);

  const nextTitle = title || pathStem;
  const nextFilename = filename || slugifyDocumentFilename(nextTitle || pathStem);

  if (nextTitle === doc.meta.title && nextFilename === (doc.meta.filename ?? "")) {
    return doc;
  }

  return {
    ...doc,
    meta: {
      ...doc.meta,
      title: nextTitle,
      ...(nextFilename ? { filename: nextFilename } : {}),
    },
  };
}
