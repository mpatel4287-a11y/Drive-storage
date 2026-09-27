import { API_BASE, getAuthToken, mediaApi, qrApi } from "./api";

// 8 MB chunk size (exact multiple of 256 KiB required by Google Drive API)
const CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Direct Resumable Cloud Uploader
 * Streams file bytes directly to Google Drive's edge network in resumable chunks.
 * Bypasses intermediate server buffering for maximum throughput on large files (100MB to 100GB).
 * Supports pausing and resuming from the exact byte offset.
 */
export async function uploadFileTurbo({
  file,
  folderId = null,
  qrToken = null,
  existingUploadUrl = null,
  onProgress,
  onSessionCreated,
  signal,
}) {
  const sizeBytes = file.size;
  const filename = file.name;
  const mimeType = file.type || "application/octet-stream";

  let uploadUrl = existingUploadUrl;

  // 1. Create or reuse resumable session
  if (!uploadUrl) {
    if (qrToken) {
      const sessionRes = await qrApi.createUploadSession(
        qrToken,
        filename,
        mimeType,
        sizeBytes
      );
      uploadUrl = sessionRes.upload_url;
    } else {
      const sessionRes = await mediaApi.createUploadSession(
        filename,
        mimeType,
        sizeBytes,
        folderId
      );
      uploadUrl = sessionRes.upload_url;
    }
    if (onSessionCreated) {
      onSessionCreated(uploadUrl);
    }
  }

  // 2. Query Google Drive for already uploaded byte range (resuming support)
  let nextByte = 0;
  if (existingUploadUrl) {
    try {
      const checkRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes */${sizeBytes}`,
        },
      });

      if (checkRes.status === 308) {
        const range = checkRes.headers.get("Range");
        if (range) {
          nextByte = parseInt(range.split("-")[1], 10) + 1;
        }
      } else if (checkRes.status === 200 || checkRes.status === 201) {
        const data = await checkRes.json();
        return await finalizeUpload(data.id, filename, mimeType, sizeBytes, folderId, qrToken);
      }
    } catch {
      nextByte = 0;
    }
  }

  // 3. Upload loop with speed & ETA calculation
  const startTime = Date.now();
  let bytesUploadedThisSession = 0;

  const emitProgress = (currentByte) => {
    const elapsedSeconds = Math.max(0.1, (Date.now() - startTime) / 1000);
    const speedBytesPerSec = bytesUploadedThisSession / elapsedSeconds;
    const speedMBps = (speedBytesPerSec / (1024 * 1024)).toFixed(2);
    const percent = Math.min(100, Math.round((currentByte / sizeBytes) * 100));
    const remainingBytes = Math.max(0, sizeBytes - currentByte);
    const etaSeconds = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;

    if (onProgress) {
      onProgress({
        uploadedBytes: currentByte,
        totalBytes: sizeBytes,
        percent,
        speedMBps,
        etaSeconds,
      });
    }
  };

  emitProgress(nextByte);

  let driveFileId = null;

  while (nextByte < sizeBytes) {
    if (signal?.aborted) {
      throw new Error("PAUSED");
    }

    const chunkEnd = Math.min(sizeBytes, nextByte + CHUNK_SIZE);
    const chunkBlob = file.slice(nextByte, chunkEnd);
    const chunkSize = chunkEnd - nextByte;

    const headers = {
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${nextByte}-${chunkEnd - 1}/${sizeBytes}`,
      "Content-Type": mimeType,
    };

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body: chunkBlob,
      signal,
    });

    if (res.status === 308) {
      const range = res.headers.get("Range");
      if (range) {
        nextByte = parseInt(range.split("-")[1], 10) + 1;
      } else {
        nextByte = chunkEnd;
      }
      bytesUploadedThisSession += chunkSize;
      emitProgress(nextByte);
    } else if (res.status === 200 || res.status === 201) {
      const data = await res.json();
      driveFileId = data.id;
      bytesUploadedThisSession += chunkSize;
      emitProgress(sizeBytes);
      break;
    } else {
      throw new Error(`Upload error: HTTP ${res.status}`);
    }
  }

  if (!driveFileId) {
    throw new Error("Drive file ID missing after completion.");
  }

  return await finalizeUpload(driveFileId, filename, mimeType, sizeBytes, folderId, qrToken);
}

async function finalizeUpload(driveFileId, filename, mimeType, sizeBytes, folderId, qrToken) {
  if (qrToken) {
    return await qrApi.completeUpload(qrToken, driveFileId, filename, mimeType, sizeBytes);
  } else {
    return await mediaApi.completeUpload(driveFileId, filename, mimeType, sizeBytes, folderId);
  }
}
