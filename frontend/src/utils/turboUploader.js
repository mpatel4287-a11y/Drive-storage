import { API_BASE, getAuthToken, mediaApi, qrApi } from "./api";

const CHUNK_SIZE = 32 * 1024 * 1024; // 32 MB chunks for direct fallback

/**
 * High-Speed Parallel Multi-Stream Uploader (Path A)
 * For large files, splits the file into 6 concurrent streams uploading simultaneously.
 */
export async function uploadFileTurbo({
  file,
  folderId = null,
  qrToken = null,
  onProgress,
  signal,
}) {
  const sizeBytes = file.size;
  const filename = file.name;
  const mimeType = file.type || "application/octet-stream";

  // Use 6-Stream Parallel Ingestion for files > 10MB when not in QR mode
  if (sizeBytes > 10 * 1024 * 1024 && !qrToken) {
    return uploadMultiStreamParallel({
      file,
      folderId,
      onProgress,
      signal,
    });
  }

  // Fallback direct-to-Drive for smaller files or QR phone uploads
  return uploadDirectResumable({
    file,
    folderId,
    qrToken,
    onProgress,
    signal,
  });
}

/**
 * 6-Stream Parallel Ingestion Engine
 */
async function uploadMultiStreamParallel({
  file,
  folderId,
  onProgress,
  signal,
}) {
  const token = getAuthToken();
  const sizeBytes = file.size;
  const filename = file.name;
  const mimeType = file.type || "application/octet-stream";
  const numParts = 6;

  // 1. Initialize multi-stream session on backend
  const initRes = await fetch(`${API_BASE}/media/upload/multi-stream/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      num_parts: numParts,
      folder_id: folderId,
    }),
    signal,
  });

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to initialize multi-stream upload.");
  }

  const { session_id, part_size } = await initRes.json();
  const streamProgress = new Array(numParts).fill(0);
  const startTime = Date.now();

  const updateStats = () => {
    const totalUploaded = streamProgress.reduce((a, b) => a + b, 0);
    const elapsedSeconds = Math.max(0.1, (Date.now() - startTime) / 1000);
    const speedBytesPerSec = totalUploaded / elapsedSeconds;
    const speedMBps = (speedBytesPerSec / (1024 * 1024)).toFixed(2);
    const percent = Math.min(100, Math.round((totalUploaded / sizeBytes) * 100));
    const remainingBytes = Math.max(0, sizeBytes - totalUploaded);
    const etaSeconds = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;

    if (onProgress) {
      onProgress({
        uploadedBytes: totalUploaded,
        totalBytes: sizeBytes,
        percent,
        speedMBps,
        etaSeconds,
        isMultiStream: true,
        streams: streamProgress.map((p, idx) => {
          const expectedStreamSize = idx === numParts - 1 ? sizeBytes - (numParts - 1) * part_size : part_size;
          return {
            streamIndex: idx + 1,
            uploaded: p,
            total: expectedStreamSize,
            percent: Math.min(100, Math.round((p / expectedStreamSize) * 100)),
          };
        }),
      });
    }
  };

  // 2. Upload all 6 parts concurrently in parallel
  const uploadPart = async (partIndex) => {
    const start = partIndex * part_size;
    const end = Math.min(sizeBytes, start + part_size);
    const slice = file.slice(start, end);

    const res = await fetch(
      `${API_BASE}/media/upload/multi-stream/${session_id}/part/${partIndex}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${token}`,
        },
        body: slice,
        signal,
      }
    );

    if (!res.ok) {
      throw new Error(`Upload stream ${partIndex + 1} failed (HTTP ${res.status}).`);
    }

    streamProgress[partIndex] = slice.size;
    updateStats();
  };

  await Promise.all(
    Array.from({ length: numParts }, (_, i) => uploadPart(i))
  );

  // 3. Finalize and pipe to Google Drive
  const completeRes = await fetch(
    `${API_BASE}/media/upload/multi-stream/${session_id}/complete`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal,
    }
  );

  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to finalize multi-stream upload.");
  }

  return await completeRes.json();
}

/**
 * Direct Resumable Upload (Fallback & QR)
 */
async function uploadDirectResumable({
  file,
  folderId,
  qrToken,
  onProgress,
  signal,
}) {
  const sizeBytes = file.size;
  const filename = file.name;
  const mimeType = file.type || "application/octet-stream";

  let uploadUrl;
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

  let nextByte = 0;
  const startTime = Date.now();

  const updateStats = (currentByte) => {
    const elapsedSeconds = Math.max(0.1, (Date.now() - startTime) / 1000);
    const speedBytesPerSec = currentByte / elapsedSeconds;
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
        isMultiStream: false,
      });
    }
  };

  let driveFileId = null;

  while (nextByte < sizeBytes) {
    if (signal?.aborted) {
      throw new Error("Upload aborted");
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
      updateStats(nextByte);
    } else if (res.status === 200 || res.status === 201) {
      const data = await res.json();
      driveFileId = data.id;
      nextByte = sizeBytes;
      updateStats(sizeBytes);
      break;
    } else {
      const statusRes = qrToken
        ? null
        : await mediaApi.getUploadStatus(uploadUrl, sizeBytes).catch(() => null);

      if (statusRes && statusRes.status === "in_progress") {
        nextByte = statusRes.next_byte;
        updateStats(nextByte);
        continue;
      } else if (statusRes && statusRes.status === "completed") {
        driveFileId = statusRes.drive_file_id;
        break;
      }

      throw new Error(`Upload error: HTTP ${res.status}`);
    }
  }

  if (!driveFileId) {
    throw new Error("Drive file ID missing after completion.");
  }

  if (qrToken) {
    return await qrApi.completeUpload(qrToken, driveFileId, filename, mimeType, sizeBytes);
  } else {
    return await mediaApi.completeUpload(driveFileId, filename, mimeType, sizeBytes, folderId);
  }
}
