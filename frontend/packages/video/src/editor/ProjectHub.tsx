import React, { useState, useEffect } from 'react';
import { videoStorage } from '../storage/videoStorage.ts';
import type { ProjectMeta } from '../ipc/video-service.ts';

interface ProjectHubProps {
  onOpen: (name: string) => void;
  onNew:  () => void;
}

export const ProjectHub: React.FC<ProjectHubProps> = ({ onOpen, onNew }) => {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    videoStorage.listProjects()
      .then(list => setProjects(list))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full w-full items-center justify-center bg-[var(--theme-bg)] p-8 overflow-y-auto">
      <div className="w-full max-w-2xl">

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[var(--theme-text)] tracking-tight">
            Video Projects
          </h2>
          <button
            onClick={onNew}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded
                       bg-[var(--theme-primary)] hover:opacity-90
                       text-[var(--theme-primary-fg)] font-medium"
          >
            + New project
          </button>
        </div>

        {loading && (
          <p className="text-sm text-[var(--theme-text-muted)]">Loading…</p>
        )}

        {!loading && projects.length === 0 && (
          <p className="text-sm text-[var(--theme-text-muted)]">
            No saved projects yet. Click <strong>New project</strong> to start.
          </p>
        )}

        {!loading && projects.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => onOpen(p.name)}
                className="flex flex-col items-start gap-1 p-4 rounded-lg border
                           border-[var(--theme-border)] bg-[var(--theme-surface)]
                           hover:border-[var(--theme-primary)] hover:bg-[var(--theme-surface)]/80
                           transition-colors text-left"
              >
                <span className="text-sm font-medium text-[var(--theme-text)] truncate w-full">
                  {p.name}
                </span>
                <span className="text-[10px] text-[var(--theme-text-muted)]">
                  {new Date(p.updated_at * 1000).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        )}

      </div>
    </div>
  );
};
