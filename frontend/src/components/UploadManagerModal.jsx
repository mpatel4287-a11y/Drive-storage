import React, { useState, useRef } from "react";
import { uploadFileTurbo } from "../utils/turboUploader";
import { Upload, X, CheckCircle, AlertCircle, Zap, ShieldCheck } from "lucide-react";

export default function UploadManagerModal({ isOpen, onClose, onUploadFinished, folders = [] }) {
  const [queue, setQueue] = useState([]); // [{ id, file, status, progress, speed, eta, error, streams }]
  const [selectedFolder, setSelectedFolder] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleFilesSelected = (files) => {
    const newItems = Array.from(files).map((f, i) => ({
      id: `${Date.now()}_${i}_${f.name}`,
      file: f,
      status: "queued",
      progress: 0,
      speed: "0.00",
      eta: 0,
      uploadedBytes: 0,
      streams: [],
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

  const startUploads = async () => {
    if (isUploading) return;
    setIsUploading(true);

    const pending = queue.filter((item) => item.status === "queued" || item.status === "error");
    const CONCURRENCY = 4;
    let index = 0;

    const runWorker = async () => {
      while (index < pending.length) {
        const item = pending[index++];
        
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: "uploading", error: null } : q))
        );

        try {
          await uploadFileTurbo({
            file: item.file,
            folderId: selectedFolder || null,
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
            prev.map((q) => (q.id === item.id ? { ...q, status: "completed", progress: 100 } : q))
          );
        } catch (err) {
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id ? { ...q, status: "error", error: err.message } : q
            )
          );
        }
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => runWorker());
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-brand-600/20 text-brand-400 rounded-lg">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Turbo 6-Stream Media Uploader</h3>
              <p className="text-xs text-slate-400">
                Multi-stream parallel pipeline (100% original quality preserved)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dropzone */}
        <div className="p-6 overflow-y-auto space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-700 hover:border-brand-500/60 rounded-xl p-8 text-center cursor-pointer transition-colors bg-slate-950/50 hover:bg-slate-800/20"
          >
            <input
              type="file"
              multiple
              ref={fileInputRef}
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
            />
            <Upload className="w-10 h-10 text-brand-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-200">
              Drag and drop original 4K videos or photos here
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Turbo 6-stream parallel uplink for large files • Resumable chunking
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
              <ShieldCheck className="w-3.5 h-3.5" /> Zero Compression • Exact Binary
            </div>
          </div>

          {/* Folder destination selector */}
          {folders.length > 0 && (
            <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-950 px-3.5 py-2.5 rounded-lg border border-slate-800">
              <span>Destination Folder:</span>
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-slate-200 focus:outline-none"
              >
                <option value="">Personal Storage (Default)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.google_drive_folder_id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Upload Queue List */}
          {queue.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Upload Queue ({queue.length})
              </h4>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-200 truncate max-w-[280px]">
                        {item.file.name}
                      </span>
                      <span className="text-slate-400 font-mono">
                        {formatSize(item.file.size)}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-200 ${
                          item.status === "completed"
                            ? "bg-emerald-500"
                            : item.status === "error"
                            ? "bg-rose-500"
                            : "bg-gradient-to-r from-amber-500 to-brand-500"
                        }`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>

                    {/* 6-Stream Active Uplink Indicators */}
                    {item.streams?.length > 1 && item.status === "uploading" && (
                      <div className="pt-1">
                        <div className="grid grid-cols-6 gap-1">
                          {item.streams.map((s) => (
                            <div key={s.streamIndex} className="bg-slate-900 p-1 rounded border border-slate-800 text-center">
                              <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden mb-0.5">
                                <div className="h-full bg-amber-400" style={{ width: `${s.percent}%` }} />
                              </div>
                              <span className="text-[8px] font-mono text-slate-400">UP{s.streamIndex}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>
                        {item.status === "completed" ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Completed & Stored
                          </span>
                        ) : item.status === "uploading" ? (
                          <span className="text-brand-400">
                            {item.progress}% ({item.speed} MB/s)
                          </span>
                        ) : item.status === "error" ? (
                          <span className="text-rose-400 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Failed
                          </span>
                        ) : (
                          "Ready in queue"
                        )}
                      </span>
                      {item.status === "uploading" && item.eta > 0 && (
                        <span>ETA: {item.eta}s</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <button
            onClick={() => setQueue([])}
            disabled={isUploading || queue.length === 0}
            className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30"
          >
            Clear Queue
          </button>

          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Close
            </button>
            <button
              onClick={startUploads}
              disabled={isUploading || queue.length === 0}
              className="px-4 py-2 text-xs font-medium text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-50 rounded-lg shadow-lg shadow-brand-600/20 transition-all flex items-center space-x-1.5"
            >
              {isUploading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Transferring...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>Start Upload</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
