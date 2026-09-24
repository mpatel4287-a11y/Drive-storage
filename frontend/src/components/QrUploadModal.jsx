import React, { useState, useEffect } from "react";
import { qrApi } from "../utils/api";
import { QrCode, X, Copy, Check, Smartphone, Clock } from "lucide-react";

export default function QrUploadModal({ isOpen, onClose }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    if (isOpen) {
      createSession();
    } else {
      setSession(null);
      setTimeLeft(null);
    }
  }, [isOpen]);

  const createSession = async () => {
    setLoading(true);
    try {
      const res = await qrApi.createSession(30); // 30 minutes
      setSession(res);
      const expires = new Date(res.expires_at).getTime();
      setTimeLeft(Math.max(0, Math.floor((expires - Date.now()) / 1000)));
    } catch (err) {
      alert(`Failed to create QR session: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!timeLeft) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  if (!isOpen) return null;

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Convert localhost URL to local IP if needed, or use window location origin
  const fullQrUrl = session
    ? `${window.location.origin}/qr-upload?token=${session.token}`
    : "";

  const handleCopy = () => {
    navigator.clipboard.writeText(fullQrUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center space-y-4">
          <div className="inline-flex p-3 bg-emerald-500/20 text-emerald-400 rounded-2xl">
            <Smartphone className="w-8 h-8" />
          </div>

          <div>
            <h3 className="text-base font-bold text-white">Phone QR Upload</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Scan with your phone's camera to upload directly without entering passwords.
            </p>
          </div>

          {loading ? (
            <div className="w-64 h-64 mx-auto flex items-center justify-center bg-slate-950 rounded-2xl border border-slate-800">
              <span className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
            </div>
          ) : session ? (
            <div className="space-y-4">
              {/* QR Image Container */}
              <div className="w-64 h-64 mx-auto bg-white p-4 rounded-2xl shadow-xl flex items-center justify-center">
                <img
                  src={qrApi.getCodeUrl(session.token)}
                  alt="QR Upload Code"
                  className="w-full h-full object-contain"
                />
              </div>

              {/* Countdown & Status */}
              <div className="flex items-center justify-center space-x-2 text-xs font-mono text-slate-400">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Session expires in:</span>
                <span className="text-amber-400 font-bold">{formatTimer(timeLeft || 0)}</span>
              </div>

              {/* Direct Link Copier */}
              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1.5 pl-3">
                <span className="text-[11px] font-mono text-slate-400 truncate flex-1 text-left">
                  {fullQrUrl}
                </span>
                <button
                  onClick={handleCopy}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs flex items-center space-x-1"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span className="text-[10px]">{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
