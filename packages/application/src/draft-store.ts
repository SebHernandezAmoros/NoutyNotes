import { validateRichTextDocument } from '@noutynotes/domain';
import type { RichTextDocument, ValidationResult } from '@noutynotes/domain';

export type DraftZone = 'title' | 'body';
export type DraftSurface = 'quick' | 'full';
export type DraftRevision = string & { readonly __draftRevision: unique symbol };
export type DraftGeneration = string & { readonly __draftGeneration: unique symbol };

export interface DraftKey {
  readonly workspaceId: string;
  readonly cardId: string;
  readonly zone: DraftZone;
}

export type DraftSource =
  | { readonly format: 'html'; readonly value: string }
  /** Transporte exacto de la autoría heredada hasta retirarla en E5. */
  | { readonly format: 'legacy-markdown'; readonly value: string }
  | { readonly format: 'rich-text'; readonly value: RichTextDocument };

export type DraftValidation =
  | { readonly status: 'pending' | 'valid' }
  | {
    readonly status: 'invalid';
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly location?: { readonly line: number; readonly column: number };
    };
  };

export interface EditorialDraft {
  readonly schemaVersion: 1;
  readonly key: DraftKey;
  readonly source: DraftSource;
  readonly baseRevision: DraftRevision;
  readonly generation: DraftGeneration;
  readonly updatedAt: string;
  readonly validation: DraftValidation;
}

export interface EditorialDraftInput {
  readonly key: DraftKey;
  readonly source: DraftSource;
  readonly baseRevision: DraftRevision;
  readonly validation: DraftValidation;
}

export type DraftStoreErrorCode =
  | 'invalid-draft'
  | 'source-too-large'
  | 'capacity-exceeded'
  | 'read-failure'
  | 'write-failure'
  | 'corrupt-store';

export interface DraftStoreIssue {
  readonly code: DraftStoreErrorCode;
  readonly message: string;
  readonly path: string;
}

export type DraftStoreResult<T> = ValidationResult<T, DraftStoreIssue>;

export interface DraftStore {
  save(input: EditorialDraftInput): Promise<DraftStoreResult<EditorialDraft>>;
  read(key: DraftKey): Promise<DraftStoreResult<EditorialDraft | null>>;
  list(workspaceId?: string): Promise<DraftStoreResult<readonly EditorialDraft[]>>;
  confirm(key: DraftKey, generation: DraftGeneration | string, persistedRevision: DraftRevision): Promise<DraftStoreResult<'cleared' | 'superseded'>>;
  discard(key: DraftKey, generation?: DraftGeneration | string): Promise<DraftStoreResult<'discarded' | 'missing' | 'superseded'>>;
  conflicts(draft: EditorialDraft, durableRevision: DraftRevision): boolean;
}

/** Snapshot privado y atómico; IndexedDB y el journal Android implementan este puerto. */
export interface DraftPersistence {
  read(): Promise<string | null>;
  write(serialized: string): Promise<void>;
}

export interface DraftStoreOptions {
  readonly now: () => string;
  readonly maxDrafts?: number;
  readonly maxSourceBytes?: number;
  readonly maxTotalBytes?: number;
}

interface DraftSnapshot {
  readonly schemaVersion: 1;
  readonly drafts: readonly EditorialDraft[];
}

const defaultOptions = { maxDrafts: 128, maxSourceBytes: 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024 } as const;

const issue = (code: DraftStoreErrorCode, path: string, message: string): DraftStoreResult<never> => ({ ok: false, issues: [{ code, path, message }] });
const success = <T>(value: T): DraftStoreResult<T> => ({ ok: true, value });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function createDraftKey(workspaceId: string, cardId: string, zone: DraftZone): DraftKey {
  return { workspaceId, cardId, zone };
}

function keyOf(key: DraftKey): string {
  return `${key.workspaceId}\u0000${key.cardId}\u0000${key.zone}`;
}

/** Revisión estable y opaca para detectar cambios, sin usar reloj ni estado de plataforma. */
export function draftRevision(source: string): DraftRevision {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `draft-rev-v1:${source.length}:${(hash >>> 0).toString(16).padStart(8, '0')}` as DraftRevision;
}

function utf8Bytes(value: string): number {
  let size = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return size;
}

function sourceBytes(source: DraftSource): number {
  return utf8Bytes(source.format === 'rich-text' ? JSON.stringify(source.value) : source.value);
}

function validKey(value: unknown): value is DraftKey {
  return isRecord(value)
    && typeof value.workspaceId === 'string' && value.workspaceId.length > 0
    && typeof value.cardId === 'string' && value.cardId.length > 0
    && (value.zone === 'title' || value.zone === 'body')
    && Object.keys(value).length === 3;
}

function validSource(value: unknown): value is DraftSource {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false;
  if (value.format === 'html' || value.format === 'legacy-markdown') return typeof value.value === 'string';
  return value.format === 'rich-text' && validateRichTextDocument(value.value as RichTextDocument).ok;
}

function validValidation(value: unknown): value is DraftValidation {
  if (!isRecord(value) || typeof value.status !== 'string') return false;
  if (value.status === 'valid' || value.status === 'pending') return Object.keys(value).length === 1;
  if (value.status !== 'invalid' || !isRecord(value.error)) return false;
  const error = value.error;
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return false;
  if (error.location !== undefined) {
    if (!isRecord(error.location) || !Number.isInteger(error.location.line) || !Number.isInteger(error.location.column)
      || (error.location.line as number) < 1 || (error.location.column as number) < 1) return false;
  }
  return true;
}

function validDraft(value: unknown): value is EditorialDraft {
  return isRecord(value) && value.schemaVersion === 1 && validKey(value.key) && validSource(value.source)
    && typeof value.baseRevision === 'string' && value.baseRevision.length > 0
    && typeof value.generation === 'string' && /^[1-9]\d*$/.test(value.generation)
    && typeof value.updatedAt === 'string' && value.updatedAt.length > 0
    && validValidation(value.validation);
}

function parseSnapshot(serialized: string | null): DraftStoreResult<DraftSnapshot> {
  if (serialized === null) return success({ schemaVersion: 1, drafts: [] });
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { return issue('corrupt-store', 'snapshot', 'El almacén privado de borradores contiene JSON inválido.'); }
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.drafts) || !value.drafts.every(validDraft)) {
    return issue('corrupt-store', 'snapshot', 'El almacén privado de borradores no cumple el formato v1.');
  }
  const identities = value.drafts.map((draft) => keyOf(draft.key));
  if (new Set(identities).size !== identities.length) return issue('corrupt-store', 'snapshot.drafts', 'Hay identidades de borrador duplicadas.');
  return success({ schemaVersion: 1, drafts: value.drafts });
}

export class PersistentDraftStore implements DraftStore {
  private readonly limits: Required<Pick<DraftStoreOptions, 'maxDrafts' | 'maxSourceBytes' | 'maxTotalBytes'>>;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly persistence: DraftPersistence, private readonly options: DraftStoreOptions) {
    this.limits = {
      maxDrafts: options.maxDrafts ?? defaultOptions.maxDrafts,
      maxSourceBytes: options.maxSourceBytes ?? defaultOptions.maxSourceBytes,
      maxTotalBytes: options.maxTotalBytes ?? defaultOptions.maxTotalBytes,
    };
  }

  save(input: EditorialDraftInput): Promise<DraftStoreResult<EditorialDraft>> {
    return this.mutate(async () => {
      if (!validKey(input.key) || !validSource(input.source) || typeof input.baseRevision !== 'string' || input.baseRevision.length === 0 || !validValidation(input.validation)) {
        return issue('invalid-draft', 'draft', 'El borrador no cumple el contrato editorial.');
      }
      const bytes = sourceBytes(input.source);
      if (bytes > this.limits.maxSourceBytes) return issue('source-too-large', 'draft.source', 'El borrador supera el límite por documento.');
      const loaded = await this.load();
      if (!loaded.ok) return loaded;
      const identity = keyOf(input.key);
      const previous = loaded.value.drafts.find((draft) => keyOf(draft.key) === identity);
      if (!previous && loaded.value.drafts.length >= this.limits.maxDrafts) return issue('capacity-exceeded', 'drafts', 'Se alcanzó el número máximo de borradores recuperables.');
      const draft: EditorialDraft = {
        schemaVersion: 1,
        key: { ...input.key },
        source: input.source.format === 'rich-text' ? { format: 'rich-text', value: structuredClone(input.source.value) } : { ...input.source },
        baseRevision: input.baseRevision,
        generation: String(previous ? Number(previous.generation) + 1 : 1) as DraftGeneration,
        updatedAt: this.options.now(),
        validation: structuredClone(input.validation),
      };
      const drafts = [...loaded.value.drafts.filter((entry) => keyOf(entry.key) !== identity), draft]
        .sort((left, right) => keyOf(left.key).localeCompare(keyOf(right.key)));
      if (drafts.reduce((total, entry) => total + sourceBytes(entry.source), 0) > this.limits.maxTotalBytes) {
        return issue('capacity-exceeded', 'drafts', 'Los borradores superan la capacidad privada disponible.');
      }
      const written = await this.write({ schemaVersion: 1, drafts });
      return written.ok ? success(structuredClone(draft)) : written;
    });
  }

  async read(key: DraftKey): Promise<DraftStoreResult<EditorialDraft | null>> {
    await this.mutationTail;
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    const found = loaded.value.drafts.find((draft) => keyOf(draft.key) === keyOf(key));
    return success(found ? structuredClone(found) : null);
  }

  async list(workspaceId?: string): Promise<DraftStoreResult<readonly EditorialDraft[]>> {
    await this.mutationTail;
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    return success(loaded.value.drafts.filter((draft) => workspaceId === undefined || draft.key.workspaceId === workspaceId).map((draft) => structuredClone(draft)));
  }

  confirm(key: DraftKey, generation: DraftGeneration | string, _persistedRevision: DraftRevision): Promise<DraftStoreResult<'cleared' | 'superseded'>> {
    return this.mutate(async () => {
      const loaded = await this.load();
      if (!loaded.ok) return loaded;
      const found = loaded.value.drafts.find((draft) => keyOf(draft.key) === keyOf(key));
      if (!found || found.generation !== generation) return success('superseded');
      const written = await this.write({ schemaVersion: 1, drafts: loaded.value.drafts.filter((draft) => keyOf(draft.key) !== keyOf(key)) });
      return written.ok ? success('cleared') : written;
    });
  }

  discard(key: DraftKey, generation?: DraftGeneration | string): Promise<DraftStoreResult<'discarded' | 'missing' | 'superseded'>> {
    return this.mutate(async () => {
      const loaded = await this.load();
      if (!loaded.ok) return loaded;
      const found = loaded.value.drafts.find((draft) => keyOf(draft.key) === keyOf(key));
      if (!found) return success('missing');
      if (generation !== undefined && found.generation !== generation) return success('superseded');
      const written = await this.write({ schemaVersion: 1, drafts: loaded.value.drafts.filter((draft) => keyOf(draft.key) !== keyOf(key)) });
      return written.ok ? success('discarded') : written;
    });
  }

  conflicts(draft: EditorialDraft, durableRevision: DraftRevision): boolean {
    return draft.baseRevision !== durableRevision;
  }

  private mutate<T>(operation: () => Promise<DraftStoreResult<T>>): Promise<DraftStoreResult<T>> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async load(): Promise<DraftStoreResult<DraftSnapshot>> {
    try { return parseSnapshot(await this.persistence.read()); } catch { return issue('read-failure', 'snapshot', 'No se pudo leer el almacén privado de borradores.'); }
  }

  private async write(snapshot: DraftSnapshot): Promise<DraftStoreResult<void>> {
    try {
      await this.persistence.write(JSON.stringify(snapshot));
      return success(undefined);
    } catch {
      return issue('write-failure', 'snapshot', 'No se pudo confirmar el borrador en almacenamiento privado.');
    }
  }
}

/** Backend compartible entre instancias para contratos y simulación de reinicio/fallos. */
export class MemoryDraftPersistence implements DraftPersistence {
  private serialized: string | null = null;
  failReads = false;
  failWrites = false;

  async read(): Promise<string | null> {
    if (this.failReads) throw new Error('simulated read failure');
    return this.serialized;
  }

  async write(serialized: string): Promise<void> {
    if (this.failWrites) throw new Error('simulated write failure');
    this.serialized = serialized;
  }

  corrupt(serialized: string): void { this.serialized = serialized; }
}

export interface EditorialSessionLease {
  readonly key: DraftKey;
  readonly surface: DraftSurface;
  readonly token: string;
}

export type SessionResult = { readonly ok: true; readonly value: EditorialSessionLease } | { readonly ok: false; readonly active: EditorialSessionLease };

/** Autoridad en memoria por workspace/tarjeta/zona; no es un bloqueo distribuido. */
export class EditorialSessionCoordinator {
  private readonly active = new Map<string, EditorialSessionLease>();
  private sequence = 0;

  constructor(private readonly createToken: () => string) {}

  acquire(key: DraftKey, surface: DraftSurface): SessionResult {
    const identity = keyOf(key);
    const active = this.active.get(identity);
    if (active) return { ok: false, active };
    const lease = { key: { ...key }, surface, token: `${this.createToken()}:${++this.sequence}` } as const;
    this.active.set(identity, lease);
    return { ok: true, value: lease };
  }

  transfer(lease: EditorialSessionLease, surface: DraftSurface): SessionResult {
    const identity = keyOf(lease.key);
    if (this.active.get(identity)?.token !== lease.token) return { ok: false, active: this.active.get(identity) ?? lease };
    const next = { key: { ...lease.key }, surface, token: `${this.createToken()}:${++this.sequence}` } as const;
    this.active.set(identity, next);
    return { ok: true, value: next };
  }

  owns(lease: EditorialSessionLease): boolean { return this.active.get(keyOf(lease.key))?.token === lease.token; }

  release(lease: EditorialSessionLease): boolean {
    if (!this.owns(lease)) return false;
    return this.active.delete(keyOf(lease.key));
  }
}
