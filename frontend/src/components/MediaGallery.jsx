import React, { useState } from "react";
import { mediaApi } from "../utils/api";
import { downloadFileTurbo } from "../utils/turboDownloader";
import {
  FileVideo,
  FileImage,
  File,
  Download,
  Zap,
  Trash2,
  Edit2,
  Eye,
  Search,
  Filter,
  ArrowUpDown,
  X,
  Play,
  CheckCircle,
} from "lucide-react";

export default function MediaGallery({
  mediaFiles,
  permissions,
  onRefresh,
}) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all"); // 'all' | 'image' | 'video'
  const [sortBy, setSortBy] = useState("date_desc");
  const [previewItem, setPreviewItem] = useState(null);
  const [renamingItem, setRenamingItem] = useState(null);
  const [newName, setNewName] = useState("");
  const [turboStats, setTurboStats] = useState(null); // active download modal state

  const formatSize = (bytes) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const isVideo = (mime) => mime?.startsWith("video/");
  const isImage = (mime) => mime?.startsWith("image/");

  const filtered = mediaFiles
    .filter((file) => {
      const matchSearch = file.name.toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;
      if (filterType === "image") return isImage(file.mime_type);
      if (filterType === "video") return isVideo(file.mime_type);
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "date_desc") return new Date(b.created_at) - new Date(a.created_at);
      if (sortBy === "date_asc") return new Date(a.created_at) - new Date(b.created_at);
      if (sortBy === "size_desc") return b.size_bytes - a.size_bytes;
      if (sortBy === "size_asc") return a.size_bytes - b.size_bytes;
      if (sortBy === "name_asc") return a.name.localeCompare(b.name);
      return 0;
    });

  const handleTurboDownload = async (file) => {
    setTurboStats({
      filename: file.name,
      percent: 0,
      speedMBps: "0.00",
      etaSeconds: 0,
      totalBytes: file.size_bytes,
      streams: [],
      done: false,
    });

    try {
      await downloadFileTurbo({
        mediaId: file.id,
        filename: file.name,
        sizeBytes: file.size_bytes,
        onProgress: (stats) => {
          setTurboStats((prev) => ({
            ...prev,
            percent: stats.percent,
            speedMBps: stats.speedMBps,
            etaSeconds: stats.etaSeconds,
            streams: stats.streams,
          }));
        },
      });

      setTurboStats((prev) => ({ ...prev, done: true, percent: 100 }));
      setTimeout(() => setTurboStats(null), 2500);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
      setTurboStats(null);
    }
  };

  const handleRename = async () => {
    if (!renamingItem || !newName.trim()) return;
    try {
      await mediaApi.renameMedia(renamingItem.id, newName.trim());
      setRenamingItem(null);
      setNewName("");
      onRefresh();
    } catch (err) {
      alert(`Rename failed: ${err.message}`);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Are you sure you want to permanently delete "${name}" from Google Drive and storage?`)) return;
    try {
      await mediaApi.deleteMedia(id);
      onRefresh();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search media files..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500"
          />
        </div>

        {/* Filter & Sort Controls */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              onClick={() => setFilterType("all")}
              className={`px-3 py-1 rounded-lg transition-colors ${
                filterType === "all" ? "bg-brand-600 text-white font-medium" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterType("image")}
              className={`px-3 py-1 rounded-lg transition-colors ${
                filterType === "image" ? "bg-brand-600 text-white font-medium" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Photos
            </button>
            <button
              onClick={() => setFilterType("video")}
              className={`px-3 py-1 rounded-lg transition-colors ${
                filterType === "video" ? "bg-brand-600 text-white font-medium" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Videos
            </button>
          </div>

          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
            >
              <option value="date_desc">Newest First</option>
              <option value="date_asc">Oldest First</option>
              <option value="size_desc">Largest First</option>
              <option value="size_asc">Smallest First</option>
              <option value="name_asc">Name (A-Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Media Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/30 rounded-2xl border border-slate-800/80">
          <File className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-300">No media found</h3>
          <p className="text-xs text-slate-500 mt-1">Upload original photos or videos to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((file) => {
            const video = isVideo(file.mime_type);
            const image = isImage(file.mime_type);

            return (
              <div
                key={file.id}
                className="group relative bg-slate-900 border border-slate-800 hover:border-brand-500/50 rounded-2xl overflow-hidden shadow-lg transition-all hover:shadow-brand-500/5 flex flex-col justify-between"
              >
                {/* Media Thumbnail / Preview Container */}
                <div
                  onClick={() => permissions?.can_preview && setPreviewItem(file)}
                  className="relative aspect-video bg-slate-950 flex items-center justify-center cursor-pointer overflow-hidden"
                >
                  {image ? (
                    <img
                      src={mediaApi.getDownloadUrl(file.id, true)}
                      alt={file.name}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : video ? (
                    <div className="relative w-full h-full bg-slate-950 flex items-center justify-center">
                      <video
                        src={mediaApi.getDownloadUrl(file.id, true)}
                        className="w-full h-full object-cover opacity-80"
                        preload="metadata"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition-colors">
                        <div className="p-3 bg-brand-600/90 text-white rounded-full shadow-lg group-hover:scale-110 transition-transform">
                          <Play className="w-5 h-5 fill-current" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <File className="w-10 h-10 text-slate-600" />
                  )}

                  {/* Size & Type Badges */}
                  <div className="absolute bottom-2 left-2 flex gap-1.5">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-white border border-white/10">
                      {formatSize(file.size_bytes)}
                    </span>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-md bg-brand-900/80 backdrop-blur-md text-brand-300 border border-brand-500/30">
                      {video ? "4K / Video" : image ? "Photo" : "Binary"}
                    </span>
                  </div>
                </div>

                {/* Metadata & Actions */}
                <div className="p-3.5 bg-slate-900 flex flex-col justify-between flex-grow">
                  <div className="mb-3">
                    <h4
                      className="text-xs font-semibold text-slate-200 truncate group-hover:text-brand-400 transition-colors"
                      title={file.name}
                    >
                      {file.name}
                    </h4>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {new Date(file.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <div className="flex items-center space-x-1">
                      {permissions?.can_download && (
                        <button
                          onClick={() => handleTurboDownload(file)}
                          className="flex items-center space-x-1 bg-brand-600/10 hover:bg-brand-600 text-brand-400 hover:text-white px-2 py-1 rounded-lg text-xs font-medium transition-all"
                          title="Turbo 6-Stream Parallel Download (Fastest)"
                        >
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-[11px]">Turbo</span>
                        </button>
                      )}

                      {permissions?.can_download && (
                        <a
                          href={mediaApi.getDownloadUrl(file.id, false)}
                          download={file.name}
                          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                          title="Direct Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    <div className="flex items-center space-x-1">
                      {permissions?.can_rename && (
                        <button
                          onClick={() => {
                            setRenamingItem(file);
                            setNewName(file.name);
                          }}
                          className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
                          title="Rename file"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {permissions?.can_delete && (
                        <button
                          onClick={() => handleDelete(file.id, file.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                          title="Delete file"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Turbo Download Active Progress Modal */}
      {turboStats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-xl">
                <Zap className="w-6 h-6 animate-pulse" />
              </div>
              <div className="overflow-hidden">
                <h3 className="text-sm font-semibold text-white truncate">
                  {turboStats.filename}
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  {turboStats.speedMBps} MB/s • {turboStats.percent}% • ETA {turboStats.etaSeconds}s
                </p>
              </div>
            </div>

            {/* Master Progress */}
            <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-brand-500 transition-all duration-150"
                style={{ width: `${turboStats.percent}%` }}
              />
            </div>

            {/* 6 Parallel Streams Monitor */}
            {turboStats.streams?.length > 1 && (
              <div className="space-y-1.5 pt-2">
                <span className="text-[10px] uppercase font-mono text-slate-500 tracking-wider">
                  6 Concurrent Active Range Streams
                </span>
                <div className="grid grid-cols-6 gap-1.5">
                  {turboStats.streams.map((s) => (
                    <div key={s.streamIndex} className="bg-slate-950 p-1.5 rounded border border-slate-800/80 text-center">
                      <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden mb-1">
                        <div className="h-full bg-brand-400" style={{ width: `${s.percent}%` }} />
                      </div>
                      <span className="text-[9px] font-mono text-slate-400">S{s.streamIndex}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {turboStats.done && (
              <div className="text-center text-xs text-emerald-400 font-medium flex items-center justify-center gap-1.5 pt-2">
                <CheckCircle className="w-4 h-4" /> Download Complete (Original Byte Integrity Preserved)
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lightbox / Video Player Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
          <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col items-center justify-center">
            <button
              onClick={() => setPreviewItem(null)}
              className="absolute -top-10 right-0 p-2 text-slate-400 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>

            {isVideo(previewItem.mime_type) ? (
              <video
                src={mediaApi.getDownloadUrl(previewItem.id, true)}
                controls
                autoPlay
                className="max-h-[80vh] w-auto max-w-full rounded-2xl shadow-2xl border border-slate-800"
              />
            ) : isImage(previewItem.mime_type) ? (
              <img
                src={mediaApi.getDownloadUrl(previewItem.id, true)}
                alt={previewItem.name}
                className="max-h-[80vh] w-auto max-w-full object-contain rounded-2xl shadow-2xl border border-slate-800"
              />
            ) : (
              <div className="p-12 text-center text-slate-300">
                Preview not supported for this file format.
              </div>
            )}

            <div className="mt-3 text-center">
              <span className="text-sm font-semibold text-white">{previewItem.name}</span>
              <span className="text-xs text-slate-400 ml-2 font-mono">({formatSize(previewItem.size_bytes)})</span>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renamingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-white">Rename Media</h3>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-brand-500"
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setRenamingItem(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                className="px-3.5 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 text-white rounded-lg"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
