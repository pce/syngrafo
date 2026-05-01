import React, { useRef, useEffect, useState, useCallback } from "react";
import SlidingAudioVisualizer from "./SlidingAudioVisualizer";
import { useAudioPlaybackWithVisualization } from "@/hooks/useAudioPlaybackWithVisualization";
import type { AudioRecordingDocument } from "@/types/audio";

interface Props {
  files:      AudioRecordingDocument[];
  onPlay?:    (file: AudioRecordingDocument) => void;
  onEdit?:    (file: AudioRecordingDocument) => void;
  onDelete?:  (file: AudioRecordingDocument) => void;
  pageSize?:  number;
  fullMode?:  boolean;
}

const AudioFilesList: React.FC<Props> = ({
  files,
  onPlay,
  onEdit,
  onDelete,
  pageSize = 10,
  fullMode = false,
}) => {
  const [displayFiles, setDisplayFiles] = useState<AudioRecordingDocument[]>([]);
  const [page, setPage]                 = useState(1);
  const listRef                         = useRef<HTMLUListElement>(null);

  const {
    play,
    stop,
    analyserNode,
    visualizationData,
    currentPlayingId,
    isPlaying,
  } = useAudioPlaybackWithVisualization();

  // Pagination
  useEffect(() => {
    setDisplayFiles(files.slice(0, page * pageSize));
  }, [files, page, pageSize]);

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const ul = listRef.current;
    if (!ul) return;
    if (ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 50) {
      if (displayFiles.length < files.length) setPage((p) => p + 1);
    }
  }, [displayFiles.length, files.length]);

  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    ul.addEventListener("scroll", handleScroll);
    return () => ul.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const handlePlay = async (file: AudioRecordingDocument) => {
    if (currentPlayingId === String(file.id) && isPlaying) {
      stop();
      return;
    }
    try {
      await play(file.blob, String(file.id ?? "unknown"));
      onPlay?.(file);
    } catch (err) {
      console.error("[AudioFilesList] play error:", err);
    }
  };

  return (
    <div className="flex flex-col w-full space-y-3">

      {/* ── Preview panel ──────────────────────────────────────────────────── */}
      {fullMode && (
        <div className="bg-[var(--theme-bg)] rounded-lg p-3 border border-[var(--theme-border)] flex items-center justify-center min-h-[120px]">
          <SlidingAudioVisualizer
            analyserNode={analyserNode}
            visualizationData={visualizationData}
            isPlaying={isPlaying}
            width={280}
            height={80}
          />
        </div>
      )}

      {/* ── File list ──────────────────────────────────────────────────────── */}
      <ul
        ref={listRef}
        className="space-y-1 rounded-lg overflow-auto max-h-[55vh] min-h-[4rem]"
        style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
      >
        {displayFiles.map((file) => {
          const active = currentPlayingId === String(file.id);
          return (
            <li
              key={file.id}
              className={`flex justify-between items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                active
                  ? "bg-blue-900/40 border border-blue-600/40"
                  : "bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]"
              }`}
            >
              {/* Name */}
              <span
                className={`truncate text-xs min-w-0 flex-1 ${
                  active ? "text-blue-300 font-medium" : "text-[var(--theme-text)]"
                }`}
              >
                {file.name}
                {active && isPlaying && (
                  <span className="ml-1.5 text-[10px] text-blue-400">♪</span>
                )}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Play / Stop */}
                {active && isPlaying ? (
                  <button
                    onClick={stop}
                    className="p-1 rounded bg-rose-600 hover:bg-rose-700 text-white transition-colors"
                    aria-label="Stop"
                  >
                    {/* stop icon */}
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="5" y="5" width="14" height="14" rx="1"/>
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={() => handlePlay(file)}
                    className="p-1 rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                    aria-label="Play"
                  >
                    {/* play icon */}
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5 3l14 9-14 9V3z"/>
                    </svg>
                  </button>
                )}

                {/* Download */}
                <a
                  href={URL.createObjectURL(file.blob)}
                  download={file.name}
                  className="p-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                  aria-label="Download"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </a>

                {/* Edit (rename) */}
                {onEdit && (
                  <button
                    onClick={() => onEdit(file)}
                    className="p-1 rounded bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                    aria-label="Rename"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                )}

                {/* Delete */}
                {onDelete && (
                  <button
                    onClick={() => onDelete(file)}
                    className="p-1 rounded bg-rose-600 hover:bg-rose-700 text-white transition-colors"
                    aria-label="Delete"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                      <path d="M10 11v6"/><path d="M14 11v6"/>
                      <path d="M9 6V4h6v2"/>
                    </svg>
                  </button>
                )}
              </div>
            </li>
          );
        })}

        {displayFiles.length < files.length && (
          <li className="text-center text-[var(--theme-text-muted)] py-2 text-xs">Loading more…</li>
        )}
        {files.length === 0 && (
          <li className="text-center text-[var(--theme-text-muted)] py-4 text-xs italic">
            No audio files yet. Upload one above.
          </li>
        )}
      </ul>
    </div>
  );
};

export default AudioFilesList;
