import { API_BASE, getAuthToken } from "./api";

/**
 * High-Speed Parallel Multi-Stream Downloader
 * Opens 6 concurrent connections to saturate downlink bandwidth.
 */
export async function downloadFileTurbo({
  mediaId,
  filename,
  sizeBytes,
  onProgress,
  signal,
}) {
  const token = getAuthToken();
  const numStreams = sizeBytes > 10 * 1024 * 1024 ? 6 : 1; // Use 6 streams for files > 10MB
  const partSize = Math.ceil(sizeBytes / numStreams);
  const downloadedChunks = new Array(numStreams);
  const streamProgress = new Array(numStreams).fill(0);
  const startTime = Date.now();

  const updateStats = () => {
    const totalReceived = streamProgress.reduce((a, b) => a + b, 0);
    const elapsedSeconds = Math.max(0.1, (Date.now() - startTime) / 1000);
    const speedBytesPerSec = totalReceived / elapsedSeconds;
    const speedMBps = (speedBytesPerSec / (1024 * 1024)).toFixed(2);
    const percent = Math.min(100, Math.round((totalReceived / sizeBytes) * 100));
    const remainingBytes = Math.max(0, sizeBytes - totalReceived);
    const etaSeconds = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;

    if (onProgress) {
      onProgress({
        totalReceived,
        sizeBytes,
        percent,
        speedMBps,
        etaSeconds,
        streams: streamProgress.map((p, idx) => {
          const streamTotal = idx === numStreams - 1 ? sizeBytes - (numStreams - 1) * partSize : partSize;
          return {
            streamIndex: idx + 1,
            received: p,
            total: streamTotal,
            percent: Math.min(100, Math.round((p / streamTotal) * 100)),
          };
        }),
      });
    }
  };

  const fetchChunk = async (streamIndex) => {
    const start = streamIndex * partSize;
    const end = Math.min(sizeBytes - 1, start + partSize - 1);
    const expectedBytes = end - start + 1;

    const res = await fetch(`${API_BASE}/media/${mediaId}/download`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Range: `bytes=${start}-${end}`,
      },
      signal,
    });

    if (!res.ok && res.status !== 206) {
      throw new Error(`Stream ${streamIndex + 1} failed: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      streamProgress[streamIndex] = received;
      updateStats();
    }

    // Combine Uint8Arrays for this stream slice
    const slice = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      slice.set(c, offset);
      offset += c.length;
    }
    downloadedChunks[streamIndex] = slice;
  };

  // Launch all streams simultaneously in parallel
  await Promise.all(
    Array.from({ length: numStreams }, (_, i) => fetchChunk(i))
  );

  // Assemble the file preserving original binary data
  const finalBlob = new Blob(downloadedChunks);
  const blobUrl = URL.createObjectURL(finalBlob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}
