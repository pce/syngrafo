// C++ → TS shape mappers (internal — NOT re-exported by dms-service.ts).
// C++ uses snake_case and some field names differ from our TS conventions.
// All translation happens here so components never see raw C++ shapes.

import type {
  FsEntry,
  DirTree,
  Keyword,
  Entity,
  ReadFileResult,
  IndexResult,
  SearchResult,
  SearchResults,
  IndexStatus,
  DocMetadata,
  WorkflowState,
  WorkflowTransition,
  DocumentLink,
  DocumentLifecycle,
  ZoneWorkflow,
  FolderDashboardData,
} from "./dms-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapEntry(raw: any): FsEntry {
  return {
    name:     String(raw.name ?? ""),
    path:     String(raw.path ?? ""),
    kind:     raw.is_dir ? "dir" : "file",
    size:     typeof raw.size === "number" ? raw.size : undefined,
    modified: typeof raw.mtime === "number" ? raw.mtime * 1000 : undefined,
    mime:     typeof raw.mime_type === "string" ? raw.mime_type : undefined,
    indexed:  !!raw.indexed,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapDirTree(raw: any): DirTree {
  return {
    path:    String(raw.path ?? ""),
    entries: Array.isArray(raw.items) ? raw.items.map(mapEntry) : [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapKeyword(raw: any): Keyword {
  return {
    term:       String(raw.term ?? ""),
    frequency:  Number(raw.frequency ?? 0),
    tfidfScore: Number(raw.tfidf_score ?? 0),
    pos:        String(raw.pos ?? ""),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapEntity(raw: any): Entity {
  return {
    text:       String(raw.text ?? ""),
    type:       String(raw.type ?? ""),
    position:   Number(raw.position ?? 0),
    confidence: Number(raw.confidence ?? 0),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapKeywords(raw: any): Keyword[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(mapKeyword);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapEntities(raw: any): Entity[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(mapEntity);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapReadFile(raw: any): ReadFileResult {
  return {
    path:      String(raw.path ?? ""),
    filename:  String(raw.filename ?? ""),
    content:   raw.binary ? null : (typeof raw.content === "string" ? raw.content : null),
    size:      Number(raw.size ?? 0),
    mtime:     Number(raw.mtime ?? 0),
    mimeType:  String(raw.mime_type ?? ""),
    lineCount: Number(raw.line_count ?? 0),
    truncated: !!raw.truncated,
    binary:    !!raw.binary,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapIndexResult(raw: any): IndexResult {
  return {
    docId:          Number(raw.doc_id ?? 0),
    path:           String(raw.path ?? ""),
    filename:       String(raw.filename ?? ""),
    mimeType:       String(raw.mime_type ?? ""),
    snippet:        String(raw.snippet ?? ""),
    keywords:       mapKeywords(raw.keywords),
    entities:       mapEntities(raw.entities),
    sentiment:      Number(raw.sentiment ?? 0),
    sentimentLabel: String(raw.sentiment_label ?? "neutral"),
    lang:           String(raw.lang ?? "en"),
    dimensions:     Number(raw.dimensions ?? 0),
    indexedAt:      Number(raw.indexed_at ?? 0),
    unchanged:      !!raw.unchanged,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSearchResult(raw: any): SearchResult {
  return {
    docId:     Number(raw.doc_id ?? 0),
    path:      String(raw.path ?? ""),
    filename:  String(raw.filename ?? ""),
    score:     Number(raw.score ?? 0),
    match:     String(raw.match ?? ""),
    snippet:   String(raw.snippet ?? ""),
    mimeType:  String(raw.mime_type ?? ""),
    keywords:  mapKeywords(raw.keywords),
    sentiment: Number(raw.sentiment ?? 0),
    lang:      String(raw.lang ?? "en"),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSearchResults(raw: any): SearchResults {
  return {
    strategy: raw.strategy === "semantic" ? "semantic" : "keyword",
    query:    String(raw.query ?? ""),
    results:  Array.isArray(raw.results) ? raw.results.map(mapSearchResult) : [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapIndexStatus(raw: any): IndexStatus {
  return {
    totalDocs:     Number(raw.total_docs ?? 0),
    bulkActive:    !!raw.bulk_active,
    lastIndexedAt: Number(raw.last_indexed_at ?? 0),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapDocMetadata(raw: any): DocMetadata {
  return {
    docId:          Number(raw.doc_id ?? 0),
    path:           String(raw.path ?? ""),
    filename:       String(raw.filename ?? ""),
    extension:      String(raw.extension ?? ""),
    mimeType:       String(raw.mime_type ?? ""),
    sizeBytes:      Number(raw.size_bytes ?? 0),
    mtime:          Number(raw.mtime ?? 0),
    indexedAt:      Number(raw.indexed_at ?? 0),
    snippet:        String(raw.snippet ?? ""),
    keywords:       mapKeywords(raw.keywords),
    entities:       mapEntities(raw.entities),
    sentiment:      Number(raw.sentiment ?? 0),
    sentimentLabel: String(raw.sentiment_label ?? "neutral"),
    lang:           String(raw.lang ?? "en"),
    hasEmbedding:   !!raw.has_embedding,
    dimensions:     Number(raw.dimensions ?? 0),
  };
}

export function mapWorkflowState(raw: any): WorkflowState {
  return {
    key: String(raw.key ?? raw.state_key ?? ""),
    label: String(raw.label ?? ""),
    color: String(raw.color ?? ""),
    category: String(raw.category ?? ""),
    isDefault: !!(raw.is_default ?? raw.isDefault),
    isTerminal: !!(raw.is_terminal ?? raw.isTerminal),
    sortOrder: Number(raw.sort_order ?? raw.sortOrder ?? 0),
  };
}

export function mapWorkflowTransition(raw: any): WorkflowTransition {
  return {
    from: String(raw.from ?? raw.from_state_key ?? ""),
    to: String(raw.to ?? raw.to_state_key ?? ""),
    label: String(raw.label ?? ""),
    requiresReason: !!(raw.requires_reason ?? raw.requiresReason),
    sortOrder: Number(raw.sort_order ?? raw.sortOrder ?? 0),
  };
}

export function mapDocumentLink(raw: any): DocumentLink {
  return {
    id: Number(raw.id ?? 0),
    zoneName: String(raw.zone_name ?? raw.zoneName ?? ""),
    sourceRef: String(raw.source_ref ?? raw.sourceRef ?? ""),
    targetRef: String(raw.target_ref ?? raw.targetRef ?? ""),
    type: String(raw.type ?? raw.link_type ?? "depends_on"),
    note: String(raw.note ?? ""),
    status: String(raw.status ?? "active"),
    createdAt: Number(raw.created_at ?? raw.createdAt ?? 0),
  };
}

export function mapDocumentLifecycle(raw: any): DocumentLifecycle {
  return {
    ...raw,
    documentUid: String(raw.document_uid ?? raw.documentUid ?? ""),
    path: String(raw.path ?? ""),
    state: String(raw.state ?? ""),
    createdAt: Number(raw.created_at ?? raw.createdAt ?? 0),
    updatedAt: Number(raw.updated_at ?? raw.updatedAt ?? 0),
    workflow: raw.workflow ? {
      id: String(raw.workflow.id ?? ""),
      zoneName: String(raw.workflow.zone_name ?? raw.workflow.zoneName ?? ""),
      currentState: String(raw.workflow.current_state ?? raw.workflow.currentState ?? ""),
      updatedAt: Number(raw.workflow.updated_at ?? raw.workflow.updatedAt ?? 0),
      states: Array.isArray(raw.workflow.states) ? raw.workflow.states.map(mapWorkflowState) : [],
      availableTransitions: Array.isArray(raw.workflow.available_transitions)
        ? raw.workflow.available_transitions.map(mapWorkflowTransition)
        : [],
    } : undefined,
    links: Array.isArray(raw.links) ? raw.links.map(mapDocumentLink) : [],
  };
}

export function mapZoneWorkflow(raw: any): ZoneWorkflow {
  return {
    id: String(raw.id ?? ""),
    zoneName: String(raw.zone_name ?? raw.zoneName ?? ""),
    name: String(raw.name ?? ""),
    states: Array.isArray(raw.states) ? raw.states.map(mapWorkflowState) : [],
    transitions: Array.isArray(raw.transitions) ? raw.transitions.map(mapWorkflowTransition) : [],
  };
}

export function mapFolderDashboard(raw: any): FolderDashboardData {
  return {
    path: String(raw.path ?? ""),
    name: String(raw.name ?? ""),
    parentPath: String(raw.parent_path ?? raw.parentPath ?? ""),
    fileCount: Number(raw.file_count ?? raw.fileCount ?? 0),
    directoryCount: Number(raw.directory_count ?? raw.directoryCount ?? 0),
    totalSize: Number(raw.total_size ?? raw.totalSize ?? 0),
    recentItems: Array.isArray(raw.recent_items) ? raw.recent_items.map((item: any) => ({
      path: String(item.path ?? ""),
      name: String(item.name ?? ""),
      mtime: Number(item.mtime ?? 0),
      size: Number(item.size ?? 0),
    })) : [],
    hotItems: Array.isArray(raw.hot_items) ? raw.hot_items.map((item: any) => ({
      path: String(item.path ?? ""),
      name: String(item.name ?? ""),
      mtime: Number(item.mtime ?? 0),
      size: Number(item.size ?? 0),
      workflowState: String(item.workflow_state ?? item.workflowState ?? ""),
      keywords: mapKeywords(item.keywords),
    })) : [],
    workflowCounts: Array.isArray(raw.workflow_counts) ? raw.workflow_counts.map((item: any) => ({
      stateKey: String(item.state_key ?? item.stateKey ?? ""),
      count: Number(item.count ?? 0),
    })) : [],
    workflow: {
      id: String(raw.workflow?.id ?? ""),
      states: Array.isArray(raw.workflow?.states) ? raw.workflow.states.map(mapWorkflowState) : [],
    },
    tagCloud: Array.isArray(raw.tag_cloud) ? raw.tag_cloud.map((item: any) => ({
      tag: String(item.tag ?? ""),
      count: Number(item.count ?? 0),
    })) : [],
    heatmap: Array.isArray(raw.heatmap) ? raw.heatmap.map((item: any) => ({
      dayOffset: Number(item.day_offset ?? item.dayOffset ?? 0),
      count: Number(item.count ?? 0),
    })) : [],
    links: Array.isArray(raw.links) ? raw.links.map(mapDocumentLink) : [],
  };
}
