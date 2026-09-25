import { FolderStorage } from '../../packages/storage/src/folder-storage';
import type { FolderPort, WorkspaceDirectory } from '../../packages/storage/src/folder-storage';
import { workspaceStorageContract } from './workspace-storage-contract';

class TestDirectory implements WorkspaceDirectory {
  readonly files = new Map<string, Uint8Array>();
  async listPaths(): Promise<readonly string[]> { return [...this.files.keys()]; }
  async read(path: string): Promise<Uint8Array | undefined> { return this.files.get(path)?.slice(); }
  async write(path: string, bytes: Uint8Array): Promise<void> { this.files.set(path, bytes.slice()); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
}

class TestPort implements FolderPort {
  readonly foldersByKey = new Map<string, TestDirectory>();
  async permission(): Promise<boolean> { return true; }
  async folders(): Promise<readonly { key: string; folder: WorkspaceDirectory }[]> {
    return [...this.foldersByKey].map(([key, folder]) => ({ key, folder }));
  }
  async createFolder(key: string): Promise<WorkspaceDirectory> {
    const folder = new TestDirectory();
    this.foldersByKey.set(key, folder);
    return folder;
  }
}

workspaceStorageContract('FolderStorage', () => new FolderStorage(new TestPort()));
