import React, { useState, useEffect } from "react";
import { membersApi } from "../utils/api";
import { Users, UserCheck, UserX, Shield, Check, X, ShieldAlert } from "lucide-react";

export default function MembersAdminModal({ isOpen, onClose, currentUser }) {
  const [tab, setTab] = useState("requests"); // 'requests' | 'members'
  const [requests, setRequests] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === "requests") {
        const res = await membersApi.listJoinRequests();
        setRequests(res);
      } else {
        const res = await membersApi.listMembers();
        setMembers(res);
      }
    } catch (err) {
      alert(`Failed to load: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleApprove = async (userId, preset) => {
    try {
      await membersApi.approveJoinRequest(userId, preset, "member");
      loadData();
    } catch (err) {
      alert(`Approval failed: ${err.message}`);
    }
  };

  const handleReject = async (userId) => {
    if (!confirm("Are you sure you want to reject this request?")) return;
    try {
      await membersApi.rejectJoinRequest(userId);
      loadData();
    } catch (err) {
      alert(`Rejection failed: ${err.message}`);
    }
  };

  const handleToggleRole = async (userId, currentRole) => {
    const newRole = currentRole === "manager" ? "member" : "manager";
    try {
      await membersApi.updateRole(userId, newRole);
      loadData();
    } catch (err) {
      alert(`Role update failed: ${err.message}`);
    }
  };

  const handleToggleStatus = async (userId, currentStatus) => {
    try {
      await membersApi.updateStatus(userId, !currentStatus);
      loadData();
    } catch (err) {
      alert(`Status update failed: ${err.message}`);
    }
  };

  const handleTogglePerm = async (userId, permName, currentValue) => {
    try {
      await membersApi.updatePermissions(userId, { [permName]: !currentValue });
      loadData();
    } catch (err) {
      alert(`Permission update failed: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-sky-500/20 text-sky-400 rounded-lg">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Member & Access Management</h3>
              <p className="text-xs text-slate-400">
                Control join requests, manager promotions, and download/preview permissions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-slate-800 px-6 text-xs">
          <button
            onClick={() => setTab("requests")}
            className={`py-3 mr-6 font-medium border-b-2 transition-colors ${
              tab === "requests"
                ? "border-brand-500 text-brand-400 font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Pending Join Requests ({requests.length})
          </button>
          <button
            onClick={() => setTab("members")}
            className={`py-3 font-medium border-b-2 transition-colors ${
              tab === "members"
                ? "border-brand-500 text-brand-400 font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Active Directory ({members.length})
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {loading ? (
            <div className="py-12 text-center">
              <span className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin inline-block" />
            </div>
          ) : tab === "requests" ? (
            requests.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">
                No pending join requests at this time.
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map((r) => (
                  <div
                    key={r.id}
                    className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <h4 className="text-sm font-semibold text-white">{r.email}</h4>
                      <p className="text-[11px] text-slate-500 font-mono">
                        Requested: {new Date(r.created_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-400 mr-1">Approve as:</span>
                      <button
                        onClick={() => handleApprove(r.id, "both")}
                        className="px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium"
                      >
                        Both
                      </button>
                      <button
                        onClick={() => handleApprove(r.id, "preview_only")}
                        className="px-2.5 py-1 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-medium"
                      >
                        Preview Only
                      </button>
                      <button
                        onClick={() => handleApprove(r.id, "download_only")}
                        className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium"
                      >
                        Download Only
                      </button>
                      <button
                        onClick={() => handleApprove(r.id, "upload_only")}
                        className="px-2.5 py-1 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium"
                      >
                        Upload Only
                      </button>
                      <button
                        onClick={() => handleReject(r.id)}
                        className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg ml-1"
                        title="Reject request"
                      >
                        <UserX className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-3">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-semibold text-white">{m.email}</span>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {m.role}
                      </span>
                      {!m.is_active && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          Disabled
                        </span>
                      )}
                    </div>

                    {/* Role & Status Controls (Admin only for role change) */}
                    <div className="flex items-center space-x-2">
                      {currentUser?.is_admin && !m.is_admin && (
                        <button
                          onClick={() => handleToggleRole(m.id, m.role)}
                          className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 font-medium"
                        >
                          {m.role === "manager" ? "Demote to Member" : "Promote to Manager"}
                        </button>
                      )}

                      {!m.is_admin && (
                        <button
                          onClick={() => handleToggleStatus(m.id, m.is_active)}
                          className={`px-2.5 py-1 text-xs rounded-lg font-medium ${
                            m.is_active
                              ? "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                              : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                          }`}
                        >
                          {m.is_active ? "Disable" : "Enable"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Granular Permission Toggles (Only for non-admin members) */}
                  {!m.is_admin && (
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                      {["can_upload", "can_download", "can_preview", "can_delete", "can_rename", "can_create_folder"].map((perm) => (
                        <button
                          key={perm}
                          onClick={() => handleTogglePerm(m.id, perm, m.permissions[perm])}
                          className={`px-2.5 py-1 rounded-md border flex items-center gap-1 font-mono transition-colors ${
                            m.permissions[perm]
                              ? "bg-brand-500/10 border-brand-500/30 text-brand-300"
                              : "bg-slate-900 border-slate-800 text-slate-500"
                          }`}
                        >
                          {m.permissions[perm] ? <Check className="w-3 h-3 text-brand-400" /> : <X className="w-3 h-3 text-slate-600" />}
                          <span>{perm.replace("can_", "")}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
