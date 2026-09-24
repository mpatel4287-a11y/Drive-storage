import React from "react";
import {
  Cloud,
  Upload,
  QrCode,
  Users,
  FolderPlus,
  LogOut,
  Shield,
  User,
} from "lucide-react";

export default function Navbar({
  user,
  permissions,
  onOpenUpload,
  onOpenQr,
  onOpenMembers,
  onOpenFolder,
  onLogout,
}) {
  const isManagerOrAdmin = user?.is_admin || user?.role === "manager";

  return (
    <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-tr from-brand-600 to-indigo-500 rounded-xl shadow-lg shadow-brand-500/20 text-white">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <span className="font-bold text-lg text-white tracking-tight flex items-center gap-2">
                Cloud Storage Portal
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-brand-400 font-mono border border-slate-700">
                  Original 4K/Lossless
                </span>
              </span>
            </div>
          </div>

          {/* Action Navigation */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {permissions?.can_upload && (
              <button
                onClick={onOpenUpload}
                className="flex items-center space-x-1.5 bg-brand-600 hover:bg-brand-500 text-white px-3.5 py-1.5 rounded-lg font-medium text-sm transition-all shadow-md shadow-brand-600/20 active:scale-95"
              >
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">Turbo Upload</span>
              </button>
            )}

            {permissions?.can_upload && (
              <button
                onClick={onOpenQr}
                className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-medium text-sm transition-all border border-slate-700 active:scale-95"
                title="Phone QR Upload"
              >
                <QrCode className="w-4 h-4 text-emerald-400" />
                <span className="hidden md:inline">Phone QR</span>
              </button>
            )}

            {isManagerOrAdmin && (
              <button
                onClick={onOpenFolder}
                className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-medium text-sm transition-all border border-slate-700 active:scale-95"
                title="Create Folder"
              >
                <FolderPlus className="w-4 h-4 text-amber-400" />
                <span className="hidden lg:inline">New Folder</span>
              </button>
            )}

            {isManagerOrAdmin && (
              <button
                onClick={onOpenMembers}
                className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-medium text-sm transition-all border border-slate-700 active:scale-95"
                title="Manage Members & Requests"
              >
                <Users className="w-4 h-4 text-sky-400" />
                <span className="hidden md:inline">Members</span>
              </button>
            )}

            {/* User Info & Role Badge */}
            <div className="flex items-center pl-2 sm:pl-3 border-l border-slate-800 space-x-2">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-semibold text-slate-200 max-w-[140px] truncate">
                  {user?.email}
                </span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
                  {user?.is_admin ? (
                    <>
                      <Shield className="w-2.5 h-2.5 text-amber-400" /> Admin
                    </>
                  ) : user?.role === "manager" ? (
                    <>
                      <Shield className="w-2.5 h-2.5 text-sky-400" /> Manager
                    </>
                  ) : (
                    <>
                      <User className="w-2.5 h-2.5 text-slate-400" /> Member
                    </>
                  )}
                </span>
              </div>

              <button
                onClick={onLogout}
                className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 rounded-lg transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
