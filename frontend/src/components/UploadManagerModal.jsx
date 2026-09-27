import React, { useState, useRef, useEffect } from "react";
import { uploadFileTurbo } from "../utils/turboUploader";
import {
  Upload,
  X,
  CheckCircle,
  AlertCircle,
  Pause,
  Play,
  Trash2,
  RotateCcw,
  Maximize2,
  Minimize2,
  Video,
  Image as ImageIcon,
  File,
  ShieldCheck,
  Folder,
} from "lucide-react";

export default function UploadManagerModal({ isOpen, onClose, onUploadFinished, folders = [] }) {
  const [queue, setQueue] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const fileInputRef = useRef(null);
  const activeControllers = useRef(new Map()); // id -> AbortController

  // Default to full screen on mobile devices
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setIsFullScreen(true);
    }
  }, []);

  if (!isOpen) return null;

  const handleFilesSelected = (files) => {
    const newItems = Array.from(files).map((f, i) => ({
      id: `${Date.now()}_${i}_${f.name}`,
      file: f,
      status: "queued", // 'queued' | 'uploading' | 'paused' | 'completed' | 'error'
      progress: 0,
      speed: "0.00",
      eta: 0,
      uploadedBytes: 0,
      uploadUrl: null,
      error: null,
    }));
    setQueue((prev) => [...prev, ...newItems]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const pauseItem = (id) => {
    const controller = activeControllers.current.get(id);
    if (controller) {
      controller.abort();
      activeControllers.current.delete(id);
    }
    setQueue((prev) =>
      prev.map((q) =>
        q.id === id ? { ...q, status: "paused", speed: "0.00", eta: 0 } : q
      )
    );
  };

  const pauseAll = () => {
    activeControllers.current.forEach((controller) => {
      controller.abort();
    });
    activeControllers.current.clear();
    setQueue((prev) =>
      prev.map((q) =>
        q.status === "uploading"
          ? { ...q, status: "paused", speed: "0.00", eta: 0 }
          : q
      )
    );
    setIsUploading(false);
  };

  const resumeItem = (id) => {
    setQueue((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: "queued", error: null } : q))
    );
    setTimeout(() => {
      startUploads();
    }, 50);
  };

  const resumeAll = () => {
    setQueue((prev) =>
      prev.map((q) =>
        q.status === "paused" || q.status === "error"
          ? { ...q, status: "queued", error: null }
          : q
      )
    );
    setTimeout(() => {
      startUploads();
    }, 50);
  };

  const removeItem = (id) => {
    const controller = activeControllers.current.get(id);
    if (controller) {
      controller.abort();
      activeControllers.current.delete(id);
    }
    setQueue((prev) => prev.filter((q) => q.id !== id));
  };

  const startUploads = async () => {
    if (isUploading) return;
    setIsUploading(true);

    const pending = queue.filter(
      (item) => item.status === "queued" || item.status === "error"
    );
    // STRICTLY 1 VIDEO AT A TIME: Dedicates full connection bandwidth to that video's 6 parallel parts
    const CONCURRENCY = 1;
    let index = 0;

    const runWorker = async () => {
      while (index < pending.length) {
        const item = pending[index++];
        if (!item) break;

        const controller = new AbortController();
        activeControllers.current.set(item.id, controller);

        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: "uploading", error: null } : q
          )
        );

        try {
          await uploadFileTurbo({
            file: item.file,
            folderId: selectedFolder || null,
            signal: controller.signal,
            onProgress: (stats) => {
              setQueue((prev) =>
                prev.map((q) =>
                  q.id === item.id
                    ? {
                        ...q,
                        progress: stats.percent,
                        speed: stats.speedMBps,
                        eta: stats.etaSeconds,
                        uploadedBytes: stats.uploadedBytes,
                        streams: stats.streams || [],
                      }
                    : q
                )
              );
            },
          });

          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? {
                    ...q,
                    status: "completed",
                    progress: 100,
                    speed: "0.00",
                    eta: 0,
                    uploadedBytes: q.file.size,
                  }
                : q
            )
          );
        } catch (err) {
          if (err.message === "PAUSED") {
            setQueue((prev) =>
              prev.map((q) =>
                q.id === item.id ? { ...q, status: "paused", speed: "0.00", eta: 0 } : q
              )
            );
          } else {
            setQueue((prev) =>
              prev.map((q) =>
                q.id === item.id
                  ? { ...q, status: "error", error: err.message, speed: "0.00" }
                  : q
              )
            );
          }
        } finally {
          activeControllers.current.delete(item.id);
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, pending.length) },
      () => runWorker()
    );
    await Promise.all(workers);

    setIsUploading(false);
    if (onUploadFinished) onUploadFinished();
  };

  const formatSize = (bytes) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const totalFiles = queue.length;
  const completedCount = queue.filter((q) => q.status === "completed").length;
  const uploadingCount = queue.filter((q) => q.status === "uploading").length;
  const pausedCount = queue.filter((q) => q.status === "paused").length;
  const errorCount = queue.filter((q) => q.status === "error").length;

  const totalBytesAll = queue.reduce((acc, q) => acc + (q.file?.size || 0), 0);
  const totalUploadedBytes = queue.reduce((acc, q) => acc + (q.uploadedBytes || 0), 0);
  const overallPercent =
    totalBytesAll > 0 ? Math.round((totalUploadedBytes / totalBytesAll) * 100) : 0;

  const getFileIcon = (mimeType, name) => {
    const isVideo =
      mimeType?.startsWith("video/") ||
      /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(name);
    const isImage =
      mimeType?.startsWith("image/") ||
      /\.(jpg|jpeg|png|heic|webp|raw|dng|gif)$/i.test(name);

    if (isVideo) {
      return (
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 flex-shrink-0">
          <Video className="w-5 h-5" />
        </div>
      );
    }
    if (isImage) {
      return (
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0">
          <ImageIcon className="w-5 h-5" />
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 flex-shrink-0">
        <File className="w-5 h-5" />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md transition-all">
      <div
        className={`bg-slate-900 border border-slate-800 shadow-2xl flex flex-col transition-all duration-200 ${
          isFullScreen
            ? "w-full h-full rounded-none"
            : "w-full max-w-4xl h-[90vh] rounded-2xl mx-4 overflow-hidden"
        }`}
      >
        {/* Top Header Bar */}
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-brand-600/20 text-brand-400 rounded-xl">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white text-base">Upload Queue</h3>
                {totalFiles > 0 && (
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                    {completedCount}/{totalFiles}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                100% original quality preserved
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Pause All / Resume All */}
            {uploadingCount > 0 ? (
              <button
                onClick={pauseAll}
                className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 transition-colors"
                title="Pause All Uploads"
              >
                <Pause className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Pause All</span>
              </button>
            ) : pausedCount > 0 || errorCount > 0 ? (
              <button
                onClick={resumeAll}
                className="flex items-center space-x-1.5 bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                title="Resume All Uploads"
              >
                <Play className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Resume All</span>
              </button>
            ) : null}

            {/* Fullscreen Toggle on desktop */}
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="hidden md:flex p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              title={isFullScreen ? "Exit Full Screen" : "Full Screen Queue"}
            >
              {isFullScreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Overall Batch Progress Banner */}
        {totalFiles > 0 && (
          <div className="bg-slate-950/40 border-b border-slate-800/80 px-5 py-2.5 flex items-center justify-between text-xs text-slate-400 flex-shrink-0">
            <div className="flex items-center gap-3">
              <span>
                Total: <strong className="text-white">{formatSize(totalUploadedBytes)}</strong> /{" "}
                {formatSize(totalBytesAll)}
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-emerald-400 font-medium">{overallPercent}% uploaded</span>
            </div>

            {/* Folder Destination Selector */}
            {folders.length > 0 && (
              <div className="flex items-center gap-2">
                <Folder className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedFolder}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="">Root / My Uploads</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Quick Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed border-slate-800 hover:border-brand-500/60 rounded-2xl p-6 text-center cursor-pointer transition-all bg-slate-950/40 hover:bg-slate-800/20 ${
              queue.length > 0 ? "py-4" : "py-10"
            }`}
          >
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              ref={fileInputRef}
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
            />
            <Upload className="w-8 h-8 text-brand-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-200">
              Tap or drag & drop photos and 4K videos here
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Direct high-speed uplink • Zero compression
            </p>
          </div>

          {/* Upload Queue List */}
          {queue.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span className="font-medium text-slate-300">Files ({queue.length})</span>
                <button
                  onClick={() => setQueue([])}
                  disabled={isUploading}
                  className="text-xs text-slate-400 hover:text-rose-400 transition-colors disabled:opacity-30"
                >
                  Clear Queue
                </button>
              </div>

              <div className="space-y-2">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-950/70 border border-slate-800/90 hover:border-slate-700/80 rounded-xl p-3.5 transition-all space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {getFileIcon(item.file?.type, item.file?.name)}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-white truncate">
                            {item.file?.name}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span>{formatSize(item.file?.size)}</span>
                            {item.status === "uploading" && (
                              <>
                                <span className="text-slate-600">•</span>
                                <span className="text-brand-400 font-mono">
                                  {item.speed} MB/s
                                </span>
                                {item.eta > 0 && (
                                  <>
                                    <span className="text-slate-600">•</span>
                                    <span className="font-mono">ETA {item.eta}s</span>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action Controls per item */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {item.status === "uploading" && (
                          <button
                            onClick={() => pauseItem(item.id)}
                            className="p-2 text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
                            title="Pause"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        )}

                        {item.status === "paused" && (
                          <button
                            onClick={() => resumeItem(item.id)}
                            className="p-2 text-brand-400 hover:bg-slate-800 rounded-lg transition-colors"
                            title="Resume"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}

                        {item.status === "error" && (
                          <button
                            onClick={() => resumeItem(item.id)}
                            className="p-2 text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
                            title="Retry"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}

                        {item.status !== "completed" && (
                          <button
                            onClick={() => removeItem(item.id)}
                            className="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                            title="Cancel / Remove"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}

                        {item.status === "completed" && (
                          <div className="p-2 text-emerald-400">
                            <CheckCircle className="w-5 h-5" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-150 ${
                          item.status === "completed"
                            ? "bg-emerald-500"
                            : item.status === "error"
                            ? "bg-rose-500"
                            : item.status === "paused"
                            ? "bg-amber-400"
                            : "bg-brand-500"
                        }`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>

                    {/* 6 Parallel Parts Monitor for active video */}
                    {item.streams?.length > 1 && item.status === "uploading" && (
                      <div className="pt-1">
                        <div className="grid grid-cols-6 gap-1.5">
                          {item.streams.map((s) => (
                            <div
                              key={s.partIndex}
                              className="bg-slate-900/90 p-1.5 rounded-lg border border-slate-800 text-center"
                            >
                              <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden mb-1">
                                <div
                                  className="h-full bg-brand-400 transition-all duration-100"
                                  style={{ width: `${s.percent}%` }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-[9px] font-mono text-slate-400">
                                <span>Part {s.partIndex}</span>
                                <span>{s.percent}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Status message */}
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>
                        {item.status === "completed" ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Completed & Stored in Drive
                          </span>
                        ) : item.status === "uploading" ? (
                          <span className="text-brand-400 font-medium">
                            Uploading ({item.progress}%)
                          </span>
                        ) : item.status === "paused" ? (
                          <span className="text-amber-400 font-medium">
                            Paused at {item.progress}%
                          </span>
                        ) : item.status === "error" ? (
                          <span className="text-rose-400 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 flex-shrink-0" />
                            {item.error || "Upload failed"}
                          </span>
                        ) : (
                          "Ready in queue"
                        )}
                      </span>
                      <span>
                        {formatSize(item.uploadedBytes)} / {formatSize(item.file?.size)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Sticky Action Bar */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-slate-400">
            {uploadingCount > 0 ? (
              <span className="text-brand-400 font-medium">
                Uploading {uploadingCount} file{uploadingCount > 1 ? "s" : ""}...
              </span>
            ) : pausedCount > 0 ? (
              <span className="text-amber-400">
                {pausedCount} file{pausedCount > 1 ? "s" : ""} paused
              </span>
            ) : completedCount === totalFiles && totalFiles > 0 ? (
              <span className="text-emerald-400 font-medium">
                All {totalFiles} files uploaded successfully!
              </span>
            ) : (
              <span>Ready to upload</span>
            )}
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              {completedCount === totalFiles && totalFiles > 0 ? "Done" : "Close"}
            </button>

            {queue.some((q) => q.status === "queued" || q.status === "error") && (
              <button
                onClick={startUploads}
                disabled={isUploading}
                className="flex items-center space-x-1.5 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition-all shadow-md shadow-brand-600/20 disabled:opacity-50 active:scale-95"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Start Upload</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
