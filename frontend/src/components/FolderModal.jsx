import React, { useState } from "react";
import { folderApi } from "../utils/api";
import { FolderPlus, X } from "lucide-react";

export default function FolderModal({ isOpen, onClose, onFolderCreated }) {
  const [folderName, setFolderName] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    setLoading(true);

    try {
      await folderApi.createFolder(folderName.trim());
      setFolderName("");
      if (onFolderCreated) onFolderCreated();
      onClose();
    } catch (err) {
      alert(`Failed to create folder: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 relative space-y-4">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-2">
          <div className="p-2 bg-amber-500/20 text-amber-400 rounded-lg">
            <FolderPlus className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-white">Create New Folder</h3>
        </div>

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Folder Name
            </label>
            <input
              type="text"
              required
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g. Wedding 4K Originals"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !folderName.trim()}
              className="px-4 py-2 text-xs bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium rounded-xl shadow-lg shadow-brand-600/20"
            >
              {loading ? "Creating in Drive..." : "Create Folder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
