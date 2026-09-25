import { startPagesPreview } from './preview-pages.mjs';

export default async function setupPagesPreview() {
  const server = await startPagesPreview();
  return async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
}
