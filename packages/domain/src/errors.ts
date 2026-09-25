/** Códigos estables para que la lógica no dependa del texto de los mensajes. */
export type DomainIssueCode =
  | 'invalid-id'
  | 'duplicate-id'
  | 'duplicate-relation'
  | 'self-relation'
  | 'card-has-relations'
  | 'invalid-value'
  | 'unsupported-schema-version'
  | 'missing-reference'
  | 'invalid-membership'
  | 'invalid-field-definition'
  | 'unknown-field'
  | 'missing-required-field'
  | 'invalid-field-value'
  | 'invalid-layout'
  | 'invalid-grid-config'
  | 'out-of-bounds'
  | 'grid-collision'
  | 'no-free-space'
  | 'invalid-asset-ref'
  | 'unknown-property'
  | 'executable-content';

export interface DomainIssue {
  readonly code: DomainIssueCode;
  /** Ubicación dentro del objeto validado, por ejemplo `cards[2].fields.camera`. */
  readonly path: string;
  readonly message: string;
}

/** Forma mínima de una incidencia; otras capas (storage) pueden ampliar sus códigos. */
export interface IssueLike {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T, I extends IssueLike = DomainIssue> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly I[] };

export class DomainError extends Error {
  readonly issues: readonly DomainIssue[];

  constructor(issues: readonly DomainIssue[]) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
    this.name = 'DomainError';
    this.issues = issues;
  }
}

export function issue(code: DomainIssueCode, path: string, message: string): DomainIssue {
  return { code, path, message };
}

export function resultOf<T>(value: T, issues: readonly DomainIssue[]): ValidationResult<T> {
  return issues.length === 0 ? { ok: true, value } : { ok: false, issues };
}

/** Resultado fallido sin valor asociado: evita inventar un valor para la rama de error. */
export function failure<T>(issues: readonly DomainIssue[]): ValidationResult<T> {
  return { ok: false, issues };
}

/** Devuelve el valor validado o lanza un `DomainError` con todas las incidencias. */
export function assertValid<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new DomainError(result.issues);
  return result.value;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Comprueba un texto opcional: si existe, debe tener contenido visible. */
export function checkOptionalText(value: unknown, path: string, issues: DomainIssue[]): void {
  if (value !== undefined && !isNonBlankString(value)) {
    issues.push(issue('invalid-value', path, 'Debe ser un texto no vacío si se indica.'));
  }
}

export function checkRequiredText(value: unknown, path: string, issues: DomainIssue[]): void {
  if (!isNonBlankString(value)) issues.push(issue('invalid-value', path, 'Debe ser un texto no vacío.'));
}

/** Recorre un valor que debería ser una lista; informa si no lo es y devuelve una lista segura. */
export function listAt(value: unknown, path: string, issues: DomainIssue[]): readonly unknown[] {
  if (Array.isArray(value)) return value;
  issues.push(issue('invalid-value', path, 'Debe ser una lista.'));
  return [];
}
