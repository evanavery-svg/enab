/**
 * Attachments live in IndexedDB as Blobs, but both backup and sync files are
 * JSON, so they cross that boundary as base64.
 */

export interface SerializedAttachment {
  id: string
  transactionId: string
  name: string
  type: string
  size: number
  data: string
  createdAt: string
}

/** `btoa` takes a string, and spreading a whole file into one blows the stack. */
const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}

export function base64ToBlob(b64: string, type: string): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}
