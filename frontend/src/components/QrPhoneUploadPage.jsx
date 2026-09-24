import React, { useState, useEffect, useRef } from "react";
import { qrApi } from "../utils/api";
import { uploadFileTurbo } from "../utils/turboUploader";
import { Smartphone, Upload, CheckCircle2, AlertCircle, Zap, ShieldCheck } from "lucide-react";

export default function QrPhoneUploadPage({ token }) {
  const [status, setStatus] = useState(null); // null | 'loading' | 'valid' | 'expired' | 'error'
  const [targetUser, setTargetUser] = useState("");
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState("0.00");
  const [eta, setEta] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const fileInputRef = useRef(null);

  useEffect(() => {
    verifySession();
  }, [token]);

  const verifySession = async () => {
    setStatus("loading");
    try {
      const res = await qrApi.getStatus(token);
      if (res.valid) {
        setStatus("valid");
        setTargetUser(res.target_user_identifier);
      } else {
        setStatus("expired");
      }
    } catch (err) {
      setStatus("expired");
    }
  };

  const handleFiles = (selectedFiles) => {
    setFiles(Array.from(selectedFiles));
  };

  const startUpload = async () => {
    if (files.length === 0 || uploading) return;
    setUploading(true);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        await uploadFileTurbo({
          file: f,
          qrToken: token,
          onProgress: (stats) => {
            setProgress(stats.percent);
            setSpeed(stats.speedMBps);
            setEta(stats.etaSeconds);
          },
        });
        setCompletedCount((c) => c + 1);
      } catch (err) {
        alert(`Failed to upload ${f.name}: ${err.message}`);
      }
    }

    setUploading(false);
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <span className="w-10 h-10 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-400">Verifying secure QR upload session...</p>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="w-12 h-12 text-rose-500 mb-3" />
        <h2 className="text-lg font-bold text-white">QR Session Expired</h2>
        <p className="text-xs text-slate-400 mt-1 max-w-xs">
          This temporary QR session has expired or is invalid. Scan a new QR code from the portal.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 max-w-lg mx-auto">
      {/* Top Header */}
      <div className="text-center pt-4">
        <div className="inline-flex p-3 bg-brand-600/20 text-brand-400 rounded-2xl mb-2">
          <Smartphone className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-bold text-white">Mobile Camera Roll Uploader</h2>
        <p className="text-xs text-slate-400">
          Target Storage: <span className="font-mono text-brand-400 font-semibold">{targetUser}</span>
        </p>
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
          <ShieldCheck className="w-3.5 h-3.5" /> 100% Original 4K Quality Preserved
        </div>
      </div>

      {/* Main Action Area */}
      <div className="my-auto space-y-5">
        {completedCount > 0 && completedCount === files.length ? (
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <h3 className="font-bold text-white text-base">All Files Uploaded!</h3>
            <p className="text-xs text-slate-400">
              Successfully saved {completedCount} media files to your cloud storage.
            </p>
            <button
              onClick={() => {
                setFiles([]);
                setCompletedCount(0);
                setProgress(0);
              }}
              className="mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium"
            >
              Upload More Files
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              onClick={() => !uploading && fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 active:border-brand-500 rounded-2xl p-8 text-center cursor-pointer bg-slate-900/60"
            >
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                ref={fileInputRef}
                onChange={(e) => handleFiles(e.target.files)}
                className="hidden"
              />
              <Upload className="w-12 h-12 text-brand-400 mx-auto mb-2" />
              <p className="font-medium text-sm text-slate-200">
                Tap to Select Photos or Videos
              </p>
              <p className="text-xs text-slate-500 mt-1">
                4K videos, live photos, RAW images (no size limit)
              </p>
            </div>

            {/* Selected files preview */}
            {files.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-300">Selected Files:</span>
                  <span className="font-mono text-brand-400 font-bold">{files.length} items</span>
                </div>

                {uploading && (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-slate-400">Speed: {speed} MB/s</span>
                      <span className="text-brand-400 font-bold">{progress}%</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 transition-all duration-150"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    {eta > 0 && (
                      <p className="text-[11px] text-right font-mono text-slate-500">
                        ETA: {eta}s
                      </p>
                    )}
                  </div>
                )}

                <button
                  onClick={startUpload}
                  disabled={uploading}
                  className="w-full py-3 bg-brand-600 active:bg-brand-500 disabled:opacity-50 text-white font-semibold text-sm rounded-xl shadow-lg shadow-brand-600/30 flex items-center justify-center space-x-2"
                >
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>{uploading ? `Uploading... (${completedCount + 1}/${files.length})` : "Start High-Speed Upload"}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="text-center pb-4 text-[11px] text-slate-600">
        Cloud Storage Portal • Direct-to-Drive Secure Socket
      </div>
    </div>
  );
}
