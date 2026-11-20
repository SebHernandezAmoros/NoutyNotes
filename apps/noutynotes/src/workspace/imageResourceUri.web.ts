/** Let the browser encode binary previews asynchronously, without constructing millions of
 * individual base64 characters on the editor's main thread. Original Asset bytes stay untouched. */
export function imageResourceUri(mimeType: string, bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image preview'));
    reader.onerror = () => reject(reader.error ?? new Error('Image preview failed'));
    reader.onabort = () => reject(new Error('Image preview aborted'));
    reader.readAsDataURL(new Blob([bytes.slice().buffer], { type: mimeType }));
  });
}
