import { API_BASE, getAuthToken, mediaApi, qrApi } from "./api";

/**
 * 6-Part Parallel Uploader
 * Divides a single file into 6 parts and uploads all 6 parts simultaneously in parallel.
 * At the end, reassembles all parts into the master file with 100% full original quality.
 */
export async function uploadFileTurbo({
  file,
  folderId = null,
  qrToken = null,
  onProgress,
  signal,
}) {
  const token = getAuthToken();
  const sizeBytes = file.size;
  const filename = file.name;
  const mimeType = file.type || "application/octet-stream";

  // Use 6 parts for files > 5MB; single stream for tiny files
  const numParts = sizeBytes > 5 * 1024 * 1024 ? 6 : 1;

  if (qrToken || numParts === 1) {
    return uploadDirectSingle({
      file,
      folderId,
      qrToken,
      onProgress,
      signal,
    });
  }

  // 1. Initialize multi-part session on backend
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
    throw new Error(err.detail || "Failed to initialize 6-part upload session.");
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
        streams: streamProgress.map((p, idx) => {
          const expectedSize =
            idx === numParts - 1
              ? sizeBytes - (numParts - 1) * part_size
              : part_size;
          return {
            partIndex: idx + 1,
            uploaded: p,
            total: expectedSize,
            percent: Math.min(100, Math.round((p / Math.max(1, expectedSize)) * 100)),
          };
        }),
      });
    }
  };

  // 2. Upload all 6 parts concurrently in parallel using XHR with real-time onprogress
  const activeXHRs = [];

  const uploadPart = (partIndex) => {
    return new Promise((resolve, reject) => {
      const start = partIndex * part_size;
      const end = Math.min(sizeBytes, start + part_size);
      const slice = file.slice(start, end);

      const xhr = new XMLHttpRequest();
      activeXHRs.push(xhr);

      xhr.open(
        "PUT",
        `${API_BASE}/media/upload/multi-stream/${session_id}/part/${partIndex}`
      );
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      if (signal) {
        signal.addEventListener("abort", () => {
          xhr.abort();
          reject(new Error("PAUSED"));
        });
      }

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          streamProgress[partIndex] = e.loaded;
          updateStats();
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          streamProgress[partIndex] = slice.size;
          updateStats();
          resolve();
        } else {
          reject(new Error(`Part ${partIndex + 1} upload failed (HTTP ${xhr.status})`));
        }
      };

      xhr.onerror = () => reject(new Error(`Network error on part ${partIndex + 1}`));
      xhr.onabort = () => reject(new Error("PAUSED"));

      xhr.send(slice);
    });
  };

  try {
    // Launch all 6 parts simultaneously!
    await Promise.all(
      Array.from({ length: numParts }, (_, i) => uploadPart(i))
    );
  } catch (err) {
    // Abort any remaining active XHRs
    activeXHRs.forEach((x) => x.abort());
    throw err;
  }

  // 3. Assemble all 6 parts into the master file with 100% full original quality
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
    throw new Error(err.detail || "Failed to assemble original media file.");
  }

  return await completeRes.json();
}

/**
 * Direct fallback for QR uploads or tiny files
 */
async function uploadDirectSingle({
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

  const startTime = Date.now();
  let nextByte = 0;
  const CHUNK_SIZE = 8 * 1024 * 1024;

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
      });
    }
  };

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
      updateStats(nextByte);
    } else if (res.status === 200 || res.status === 201) {
      const data = await res.json();
      driveFileId = data.id;
      updateStats(sizeBytes);
      break;
    } else {
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
