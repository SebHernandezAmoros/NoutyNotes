import { validateTemplate } from '@noutynotes/domain';
import type { DomainIssue, Template } from '@noutynotes/domain';

import { compact, mergeWithPrevious, previousFilesIssues, readVersionedYaml, yamlDocument } from './documents';
import type { GeneratedDocument, PreviousPackage } from './documents';
import { fail, storageIssue, succeed } from './issues';
import type { StorageIssue, StorageResult } from './issues';
import { isPortableAssetRef } from './paths';
import { templateFileSchema } from './schemas';
import { validateTextFiles } from './text-files';
import type { TextFiles } from './text-files';

export const TEMPLATE_FILE = 'template.yaml';
export const TEMPLATE_README = 'README.md';
const ASSETS_DIRECTORY = 'assets/';

/**
 * template.yaml guarda la plantilla declarativa sin `readme`; el README vive aparte, con su texto
 * exacto. `readmeFile` distingue README ausente de README vacío.
 */
function templateDocuments(template: Template): Map<string, GeneratedDocument> {
  const { readme, ...definition } = template;
  const documents = new Map<string, GeneratedDocument>();
  documents.set(TEMPLATE_FILE, yamlDocument(compact({
    schemaVersion: 1, definition, readmeFile: readme === undefined ? undefined : TEMPLATE_README,
  })));
  if (readme !== undefined) documents.set(TEMPLATE_README, { text: readme, key: readme });
  return documents;
}

/** Catálogo, preview, assetRefs y campos `asset` deben ser rutas portables. */
function assetPathIssues(template: Template, locate: (path: string) => string): StorageIssue[] {
  const message = 'Las referencias a assets deben ser rutas portables.';
  const issues: StorageIssue[] = [];
  const check = (ref: unknown, path: string): void => {
    if (!isPortableAssetRef(ref)) issues.push(storageIssue('invalid-path', locate(path), message));
  };
  template.assets?.forEach((ref, index) => check(ref, `assets[${index}]`));
  if (template.preview !== undefined) check(template.preview, 'preview');
  const kinds = new Map(template.cardTypes.map((type) => [type.id, new Map(type.fields.map((field) => [field.key as string, field.kind]))]));
  template.cards?.forEach((card, index) => {
    card.assetRefs?.forEach((ref, j) => check(ref, `cards[${index}].assetRefs[${j}]`));
    for (const [key, value] of Object.entries(card.fields)) {
      if (kinds.get(card.typeId)?.get(key) === 'asset') check(value, `cards[${index}].fields.${key}`);
    }
  });
  return issues;
}

function locateTemplateIssue(issue: DomainIssue | StorageIssue): StorageIssue {
  if (issue.path === 'readme') return { ...issue, path: TEMPLATE_README };
  return { ...issue, path: issue.path ? `${TEMPLATE_FILE}#definition.${issue.path}` : `${TEMPLATE_FILE}#definition` };
}

interface TemplatePackage {
  readonly template: Template;
  readonly files: TextFiles;
  readonly extras: ReadonlyMap<string, string>;
}

function readTemplatePackage(input: unknown): StorageResult<TemplatePackage> {
  const validated = validateTextFiles(input);
  if (!validated.ok) return validated;
  const files = validated.value;
  const text = files[TEMPLATE_FILE];
  if (text === undefined) return fail([storageIssue('missing-file', TEMPLATE_FILE, 'Falta template.yaml.')]);
  const envelope = readVersionedYaml(text, TEMPLATE_FILE, templateFileSchema);
  if (!envelope.ok) return envelope;
  const { definition, readmeFile } = envelope.value;
  if (Object.hasOwn(definition, 'readme')) {
    return fail([storageIssue('unknown-property', `${TEMPLATE_FILE}#definition.readme`, 'El README se guarda en README.md y se declara con readmeFile.')]);
  }

  const issues: StorageIssue[] = [];
  const extras = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    if (path === TEMPLATE_FILE || (path === TEMPLATE_README && readmeFile !== undefined)) continue;
    if (path.startsWith(ASSETS_DIRECTORY)) extras.set(path, content);
    else issues.push(storageIssue('unexpected-file', path, 'Archivo no declarado por la plantilla ni admitido como extra (assets/).'));
  }
  const readme = readmeFile === undefined ? undefined : files[TEMPLATE_README];
  if (readmeFile !== undefined && readme === undefined) {
    issues.push(storageIssue('missing-file', TEMPLATE_README, 'template.yaml declara un README que no existe.'));
  }
  if (issues.length > 0) return fail(issues);

  // Datos con la forma del sobre comprobada; `validateTemplate` decide si son una plantilla válida.
  const candidate = (readme === undefined ? { ...definition } : { ...definition, readme }) as unknown as Template;
  const semantic = validateTemplate(candidate);
  if (!semantic.ok) return fail(semantic.issues.map(locateTemplateIssue));
  const portability = assetPathIssues(candidate, (path) => `${TEMPLATE_FILE}#definition.${path}`);
  return portability.length > 0 ? fail(portability) : succeed({ template: candidate, files, extras });
}

/**
 * Lee una plantilla v1: sobre versionado con claves cerradas, definición declarativa validada por
 * el dominio (incluida su grilla inicial de 12 columnas), README opcional y assets como extras.
 */
export function parseTemplate(files: TextFiles): StorageResult<Template> {
  const read = readTemplatePackage(files);
  return read.ok ? succeed(read.value.template) : read;
}

/**
 * Escribe una plantilla como template.yaml y README.md opcional. Con `previousFiles` reutiliza los
 * bytes de los documentos sin cambios semánticos y conserva los extras bajo assets/. La plantilla
 * nunca se evalúa: los textos que parecen código siguen siendo texto.
 */
export function serializeTemplate(template: Template, previousFiles?: TextFiles): StorageResult<TextFiles> {
  const checked = validateTemplate(template);
  if (!checked.ok) return fail(checked.issues);
  const portability = assetPathIssues(template, (path) => path);
  if (portability.length > 0) return fail(portability);
  let previous: PreviousPackage | undefined;
  if (previousFiles !== undefined) {
    const read = readTemplatePackage(previousFiles);
    if (!read.ok) return fail(previousFilesIssues(read.issues));
    previous = { ...read.value, documents: templateDocuments(read.value.template) };
  }
  return mergeWithPrevious(templateDocuments(template), previous);
}
