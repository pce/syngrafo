import React, { useState } from "react";
import { useDms } from "../../store/dms-store";
import { dms, type Zone } from "../../services/dms-service";

interface ImportModalProps {
  filePath: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ filePath, onClose, onSuccess }) => {
  const { state, dispatch } = useDms();
  const [selectedZone, setSelectedZone] = useState<string>(state.zone?.name || "");
  const [scan, setScan] = useState(false);
  const [compress, setCompress] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    if (!selectedZone) return;
    setLoading(true);
    try {
      const res = await dms.importToZone(filePath, selectedZone, compress, scan);
      if (res.ok) {
        onSuccess();
        onClose();
      } else {
        dispatch({ type: "SET_ERROR", error: res.error || "Import failed" });
      }
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-4 text-zinc-100">Import to Zone</h2>

        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-400 mb-1">Source File</label>
          <div className="text-xs text-zinc-300 truncate bg-zinc-800 p-2 rounded border border-zinc-700">
            {filePath}
          </div>
        </div>

        <div className="mb-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Target Zone</label>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-zinc-200"
            >
              <option value="">Select a zone...</option>
              {state.zones.map((z) => (
                <option key={z.name} value={z.name}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="scan-opt"
              checked={scan}
              onChange={(e) => setScan(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-800 text-blue-500 focus:ring-blue-500"
            />
            <label htmlFor="scan-opt" className="text-sm text-zinc-200">
              Apply Scan (ONNX Rectification)
            </label>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="compress-opt"
              checked={compress}
              onChange={(e) => setCompress(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-800 text-blue-500 focus:ring-blue-500"
            />
            <label htmlFor="compress-opt" className="text-sm text-zinc-200">
              Compress Content
            </label>
          </div>
        </div>

        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!selectedZone || loading}
            className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
              !selectedZone || loading
                ? "bg-blue-600/50 text-white/50 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-500"
            }`}
          >
            {loading ? "Importing..." : "Start Import"}
          </button>
        </div>
      </div>
    </div>
  );
};
