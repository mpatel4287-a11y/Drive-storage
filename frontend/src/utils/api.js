export const API_BASE = import.meta.env.VITE_API_URL || "";

export const getAuthToken = () => localStorage.getItem("csp_token");
export const setAuthToken = (token) => localStorage.setItem("csp_token", token);
export const removeAuthToken = () => localStorage.removeItem("csp_token");

export async function request(path, options = {}) {
  const token = getAuthToken();
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token && !options.skipAuth) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401 && !options.skipAuth) {
    removeAuthToken();
    window.dispatchEvent(new Event("auth-expired"));
    throw new Error("Session expired. Please log in again.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Request failed with status ${res.status}`);
  }

  return data;
}

// ---------------------------------------------------------
// Auth API
// ---------------------------------------------------------
export const authApi = {
  login: (email, password) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    }),

  register: (email, password) =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    }),

  getMe: () => request("/auth/me"),

  forgotPassword: (email) =>
    request("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
      skipAuth: true,
    }),

  resetPassword: (token, new_password) =>
    request("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, new_password }),
      skipAuth: true,
    }),
};

// ---------------------------------------------------------
// Media API
// ---------------------------------------------------------
export const mediaApi = {
  listMedia: (allFiles = false) =>
    request(`/media?all_files=${allFiles ? "true" : "false"}`),

  getMedia: (id) => request(`/media/${id}`),

  createUploadSession: (filename, mimeType, sizeBytes, folderId = null) =>
    request("/media/upload/session", {
      method: "POST",
      body: JSON.stringify({
        filename,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        folder_id: folderId,
      }),
    }),

  getUploadStatus: (uploadUrl, sizeBytes) =>
    request("/media/upload/status", {
      method: "POST",
      body: JSON.stringify({
        upload_url: uploadUrl,
        size_bytes: sizeBytes,
      }),
    }),

  completeUpload: (driveFileId, filename, mimeType, sizeBytes, folderId = null) =>
    request("/media/upload/complete", {
      method: "POST",
      body: JSON.stringify({
        google_drive_file_id: driveFileId,
        filename,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        folder_id: folderId,
      }),
    }),

  renameMedia: (id, name) =>
    request(`/media/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),

  deleteMedia: (id) =>
    request(`/media/${id}`, {
      method: "DELETE",
    }),

  getDownloadUrl: (id, inline = false) =>
    `${API_BASE}/media/${id}/download?inline=${inline ? "true" : "false"}`,
};

// ---------------------------------------------------------
// Members & Permissions API
// ---------------------------------------------------------
export const membersApi = {
  getMyPermissions: () => request("/permissions/me"),

  listMembers: () => request("/members"),

  listJoinRequests: () => request("/members/join-requests"),

  approveJoinRequest: (userId, accessPreset = "both", role = "member") =>
    request(`/members/join-requests/${userId}/approve`, {
      method: "POST",
      body: JSON.stringify({ access_preset: accessPreset, role }),
    }),

  rejectJoinRequest: (userId) =>
    request(`/members/join-requests/${userId}/reject`, {
      method: "POST",
    }),

  updateRole: (userId, role) =>
    request(`/members/users/${userId}/role`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    }),

  updatePermissions: (userId, permissions) =>
    request(`/members/users/${userId}/permissions`, {
      method: "PUT",
      body: JSON.stringify(permissions),
    }),

  updateStatus: (userId, isActive) =>
    request(`/members/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: isActive }),
    }),
};

// ---------------------------------------------------------
// QR API
// ---------------------------------------------------------
export const qrApi = {
  createSession: (expiresInMinutes = 30) =>
    request("/qr/session", {
      method: "POST",
      body: JSON.stringify({ expires_in_minutes: expiresInMinutes }),
    }),

  getStatus: (token) =>
    request(`/qr/${token}/status`, { skipAuth: true }),

  createUploadSession: (token, filename, mimeType, sizeBytes) =>
    request(`/qr/${token}/upload/session`, {
      method: "POST",
      body: JSON.stringify({
        filename,
        mime_type: mimeType,
        size_bytes: sizeBytes,
      }),
      skipAuth: true,
    }),

  completeUpload: (token, driveFileId, filename, mimeType, sizeBytes) =>
    request(`/qr/${token}/upload/complete`, {
      method: "POST",
      body: JSON.stringify({
        google_drive_file_id: driveFileId,
        filename,
        mime_type: mimeType,
        size_bytes: sizeBytes,
      }),
      skipAuth: true,
    }),

  getCodeUrl: (token) => `${API_BASE}/qr/${token}/code`,
};

// ---------------------------------------------------------
// Folders API
// ---------------------------------------------------------
export const folderApi = {
  listFolders: () => request("/folders"),

  createFolder: (name, parentFolderId = null) =>
    request("/folders", {
      method: "POST",
      body: JSON.stringify({
        name,
        parent_folder_id: parentFolderId,
      }),
    }),
};
