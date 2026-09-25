import { ArchiveStorage } from '../../packages/storage/src/index';
import { workspaceStorageContract } from './workspace-storage-contract';

// El almacenamiento del navegador para el fallback ZIP (ADR 0011) cumple el mismo contrato del puerto.
workspaceStorageContract('ArchiveStorage', () => new ArchiveStorage());
