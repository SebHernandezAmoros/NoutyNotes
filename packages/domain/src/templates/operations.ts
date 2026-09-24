import type { DomainIssue, ValidationResult } from '../errors';
import type { Id, WorkspaceId } from '../ids';
import type { Workspace } from '../workspace/workspace';
import type { AssetRef } from '../assets/asset-ref';
import type { Template, TemplateManifest } from './template';
import { collectExecutableContentIssues, templateWorkspace, validateTemplate } from './template';
import { checkRequiredText, failure, isRecord, issue, resultOf } from '../errors';
import { checkId } from '../ids';
import { validateWorkspace } from '../workspace/workspace';
import { copyTemplateData } from './data';

export interface InstantiateTemplateOptions { readonly workspaceId: WorkspaceId; readonly name: string; readonly namespace: string }
export interface DuplicateTemplateOptions { readonly manifest: TemplateManifest; readonly namespace: string }
export interface TemplateInstance { readonly workspace: Workspace; readonly assets: readonly AssetRef[]; readonly readme?: string; readonly preview?: AssetRef }

function optionIssues(options: unknown, keys: readonly string[]): DomainIssue[] {
  const issues: DomainIssue[] = [];
  collectExecutableContentIssues(options, 'options', issues);
  if (issues.length > 0) return issues;
  if (!isRecord(options)) return [issue('invalid-value', 'options', 'Debe ser un objeto de opciones.')];
  for (const key of Object.keys(options)) if (!keys.includes(key)) issues.push(issue('unknown-property', `options.${key}`, 'Opción desconocida.'));
  checkId(options.namespace, 'options.namespace', issues);
  return issues;
}

/** Prefixar es inyectivo en cada ámbito. La validación posterior rechaza longitudes excesivas. */
function remap(source: Template, namespace: string): Template {
  const template = copyTemplateData(source);
  const rename = <T extends Id<string>>(id: T): T => `${namespace}-${id}` as T;
  return {
    ...template,
    cardTypes: template.cardTypes.map(type => ({ ...type, id: rename(type.id) })),
    relationTypes: template.relationTypes.map(type => ({ ...type, id: rename(type.id) })),
    boards: template.boards.map(board => ({ ...board, id: rename(board.id),
      ...(board.cardIds === undefined ? {} : { cardIds: board.cardIds.map(rename) }),
    })),
    ...(template.cards === undefined ? {} : { cards: template.cards.map(card => ({ ...card, id: rename(card.id), typeId: rename(card.typeId) })) }),
    ...(template.relations === undefined ? {} : { relations: template.relations.map(relation => ({ ...relation, id: rename(relation.id), typeId: rename(relation.typeId), from: rename(relation.from), to: rename(relation.to) })) }),
    ...(template.layouts === undefined ? {} : { layouts: template.layouts.map(layout => ({ ...layout, boardId: rename(layout.boardId), placements: layout.placements.map(placement => ({ ...placement, cardId: rename(placement.cardId) })) })) }),
  };
}

export function instantiateTemplate(input: unknown, options: InstantiateTemplateOptions): ValidationResult<TemplateInstance> {
  const checked = validateTemplate(input);
  if (!checked.ok) return failure(checked.issues);
  const issues = optionIssues(options, ['workspaceId', 'name', 'namespace']);
  if (issues.length > 0) return failure(issues);
  checkId(options.workspaceId, 'options.workspaceId', issues);
  checkRequiredText(options.name, 'options.name', issues);
  if (issues.length > 0) return failure(issues);
  const template = remap(checked.value, options.namespace);
  const workspace = validateWorkspace(templateWorkspace(template, options.workspaceId, { name: options.name }));
  if (!workspace.ok) return failure(workspace.issues);
  return resultOf({ workspace: workspace.value, assets: template.assets ?? [],
    ...(template.readme === undefined ? {} : { readme: template.readme }),
    ...(template.preview === undefined ? {} : { preview: template.preview }),
  }, []);
}

export function duplicateTemplate(input: unknown, options: DuplicateTemplateOptions): ValidationResult<Template> {
  const checked = validateTemplate(input);
  if (!checked.ok) return failure(checked.issues);
  const issues = optionIssues(options, ['manifest', 'namespace']);
  if (issues.length > 0) return failure(issues);
  const duplicate = validateTemplate({ ...remap(checked.value, options.namespace), template: copyTemplateData(options.manifest) });
  if (!duplicate.ok) return duplicate;
  if (duplicate.value.template.id === checked.value.template.id) return failure([issue('duplicate-id', 'options.manifest.id', 'La copia debe tener otro ID de plantilla.')]);
  return resultOf(copyTemplateData(duplicate.value), []);
}
