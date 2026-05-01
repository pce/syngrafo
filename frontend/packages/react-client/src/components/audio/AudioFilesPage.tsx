import React, { useEffect, useState, useRef } from "react";
import AudioFilesList from "./AudioFilesList";
import { audioStorage } from "@/storage/audioStorage";
import type { AudioRecordingDocument } from "@/types/audio";

function blobFromFile(file: File): Promise<Blob> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(new Blob([reader.result as ArrayBuffer], { type: file.type }));
    reader.readAsArrayBuffer(file);
  });
}

const AudioFilesPage: React.FC = () => {
  const [files,      setFiles]      = useState<AudioRecordingDocument[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initial load
  useEffect(() => {
    audioStorage.getAudioFiles().then((data) => setFiles(data.reverse()));
  }, []);

  // Upload
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const blob = await blobFromFile(file);
      let duration: number | undefined;
      try {
        const audio = document.createElement("audio");
        audio.src = URL.createObjectURL(blob);
        await new Promise<void>((res) => { audio.onloadedmetadata = () => res(); });
        duration = audio.duration;
      } catch { /* duration stays undefined */ }

      await audioStorage.addAudioFile({
        name: file.name, blob, mimeType: file.type, duration,
      });
      const allFiles = await audioStorage.getAudioFiles();
      setFiles(allFiles.reverse());
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (file: AudioRecordingDocument) => {
    if (!window.confirm(`Delete "${file.name}"?`)) return;
    await audioStorage.deleteAudioFile(Number(file.id));
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
  };

  const handleEdit = async (file: AudioRecordingDocument) => {
    const newName = prompt("Rename file:", file.name);
    if (!newName || newName === file.name) return;
    await audioStorage.updateAudioFile({ ...file, name: newName });
    setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, name: newName } : f)));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">
        <span className="text-xs font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
          Audio Library
        </span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleUpload}
            disabled={isUploading}
            className="sr-only"
          />
          <span
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
              isUploading
                ? "bg-[var(--theme-border)] text-[var(--theme-text-muted)] cursor-not-allowed"
                : "bg-[var(--theme-primary)] hover:opacity-90 text-white cursor-pointer"
            }`}
          >
            {isUploading ? "Uploading…" : "+ Import file"}
          </span>
        </label>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <AudioFilesList
          fullMode
          files={files}
          onEdit={handleEdit}
          onDelete={handleDelete}
          pageSize={20}
        />
      </div>
    </div>
  );
};

export default AudioFilesPage;
