import { dataUri } from './dataUri';

/** Native fallback: preserve the existing offline URI contract. */
export async function imageResourceUri(mimeType: string, bytes: Uint8Array): Promise<string> {
  return dataUri(mimeType, bytes);
}
