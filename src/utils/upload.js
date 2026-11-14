// Browser-side MP3 handling for the upload flow: the file is read
// as base64 for the JSON POST body, and its duration is measured
// with an <audio> element because Apps Script cannot parse MP3s —
// the measured seconds become the track's duration_sec.

/** The upload size limit, mirrored from music-gas (10 MB raw). */
export const MAX_MP3_BYTES = 10 * 1024 * 1024

/** Encode an ArrayBuffer as base64, in chunks (no call-stack blowup). */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Read a File/Blob as base64 text. */
export async function fileToBase64(file, FileReaderImpl = globalThis.FileReader) {
  const buffer = await new Promise((resolve, reject) => {
    const reader = new FileReaderImpl()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('file read failed'))
    reader.readAsArrayBuffer(file)
  })
  return arrayBufferToBase64(buffer)
}

/**
 * Measure an audio Blob's duration in whole seconds via a
 * temporary object URL and an <audio> element. Resolves to 0
 * when the browser cannot measure it (the form field stays
 * editable either way).
 */
export function measureDurationSeconds(
  blob,
  { createObjectURL = URL.createObjectURL, revokeObjectURL = URL.revokeObjectURL, AudioImpl = globalThis.Audio } = {},
) {
  return new Promise((resolve) => {
    let url
    try {
      url = createObjectURL(blob)
    } catch {
      resolve(0)
      return
    }
    const audio = new AudioImpl()
    const finish = (seconds) => {
      revokeObjectURL(url)
      resolve(seconds)
    }
    audio.addEventListener('loadedmetadata', () => {
      const duration = Number(audio.duration)
      finish(Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0)
    })
    audio.addEventListener('error', () => finish(0))
    audio.src = url
  })
}
