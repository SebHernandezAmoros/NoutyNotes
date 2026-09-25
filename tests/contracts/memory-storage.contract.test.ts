import { MemoryStorage } from '../../packages/storage/src/index';
import { workspaceStorageContract } from './workspace-storage-contract';

// El mismo contrato se ejecutará contra los adaptadores de carpetas web (fase 8) y Android (fase 10).
workspaceStorageContract('MemoryStorage', () => new MemoryStorage());
