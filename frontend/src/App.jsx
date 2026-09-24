import React, { useState, useEffect } from "react";
import { authApi, mediaApi, membersApi, folderApi, removeAuthToken, getAuthToken } from "./utils/api";
import Navbar from "./components/Navbar";
import MediaGallery from "./components/MediaGallery";
import AuthModal from "./components/AuthModal";
import UploadManagerModal from "./components/UploadManagerModal";
import QrUploadModal from "./components/QrUploadModal";
import QrPhoneUploadPage from "./components/QrPhoneUploadPage";
import MembersAdminModal from "./components/MembersAdminModal";
import FolderModal from "./components/FolderModal";

export default function App() {
  // Check if opened via QR code link (?token=... or /qr-upload?token=...)
  const searchParams = new URLSearchParams(window.location.search);
  const qrToken = searchParams.get("token");

  if (qrToken) {
    return <QrPhoneUploadPage token={qrToken} />;
  }

  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [mediaFiles, setMediaFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [uploadOpen, setUploadOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
      setPermissions(null);
    };
    window.addEventListener("auth-expired", handleAuthExpired);
    loadSession();
    return () => window.removeEventListener("auth-expired", handleAuthExpired);
  }, []);

  const loadSession = async () => {
    const token = getAuthToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const me = await authApi.getMe();
      setUser(me);
      const perms = await membersApi.getMyPermissions();
      setPermissions(perms);
      await loadMediaAndFolders();
    } catch (err) {
      removeAuthToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const loadMediaAndFolders = async () => {
    try {
      const [mediaList, folderList] = await Promise.all([
        mediaApi.listMedia(true).catch(() => []),
        folderApi.listFolders().catch(() => []),
      ]);
      setMediaFiles(mediaList);
      setFolders(folderList);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = () => {
    removeAuthToken();
    setUser(null);
    setPermissions(null);
    setMediaFiles([]);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <span className="w-10 h-10 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {!user ? (
        <AuthModal onLoginSuccess={loadSession} />
      ) : (
        <>
          <Navbar
            user={user}
            permissions={permissions}
            onOpenUpload={() => setUploadOpen(true)}
            onOpenQr={() => setQrOpen(true)}
            onOpenMembers={() => setMembersOpen(true)}
            onOpenFolder={() => setFolderOpen(true)}
            onLogout={handleLogout}
          />

          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <MediaGallery
              mediaFiles={mediaFiles}
              permissions={permissions}
              onRefresh={loadMediaAndFolders}
            />
          </main>

          {/* Modals */}
          <UploadManagerModal
            isOpen={uploadOpen}
            onClose={() => setUploadOpen(false)}
            onUploadFinished={loadMediaAndFolders}
            folders={folders}
          />

          <QrUploadModal
            isOpen={qrOpen}
            onClose={() => setQrOpen(false)}
          />

          <MembersAdminModal
            isOpen={membersOpen}
            onClose={() => setMembersOpen(false)}
            currentUser={user}
          />

          <FolderModal
            isOpen={folderOpen}
            onClose={() => setFolderOpen(false)}
            onFolderCreated={loadMediaAndFolders}
          />
        </>
      )}
    </div>
  );
}
