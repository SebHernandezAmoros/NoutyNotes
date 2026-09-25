import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';
import { workspaceStorageContract } from './workspace-storage-contract';

// Adaptador Android (ADR 0012): FolderStorage sobre un árbol de documentos como el SAF.
workspaceStorageContract('FolderStorage sobre DocumentTree (Android)', () => new FolderStorage(new DocumentTreeFolderPort(new MemoryDocumentTree())));
