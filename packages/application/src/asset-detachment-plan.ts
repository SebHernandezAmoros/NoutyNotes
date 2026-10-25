import { isValidAssetRef, parseNoteBlocks, richTextImageRefs, validateWorkspace } from '@noutynotes/domain';
import type { AssetRef, Card, PrimaryResourceState, RichTextRetiredImage, Workspace } from '@noutynotes/domain';
import { analyzeAssetReferences } from './asset-reference-analysis';
import type { AssetReferenceAnalysis, AssetReferenceOccurrence, AssetReferenceOwner } from './asset-reference-analysis';

export type NoteImagePolicy = 'keep-marker' | 'remove-block';
export interface AssetDetachmentPlanInput {
  readonly snapshot: Workspace;
  readonly assetRef: AssetRef;
  readonly analysis: AssetReferenceAnalysis;
  readonly noteImagePolicy?: NoteImagePolicy;
  readonly exceptions?: { readonly sourceSnapshot: string; readonly values: readonly { readonly occurrenceId: string; readonly policy: NoteImagePolicy }[] };
}

export type AssetDetachmentProposal =
  | { readonly kind: 'keep-marker'; readonly marker: RichTextRetiredImage }
  | { readonly kind: 'remove-block'; readonly loss: 'image-and-own-caption' }
  | { readonly kind: 'retire-card'; readonly state: PrimaryResourceState }
  | { readonly kind: 'unsupported'; readonly reason: string };
export interface AssetDetachmentEntry extends AssetReferenceOccurrence {
  /** This key is reliable only together with the enclosing sourceSnapshot. */
  readonly decisionKey: string;
  readonly policy: NoteImagePolicy | null;
  readonly proposal: AssetDetachmentProposal;
}
export interface AssetDetachmentPlan {
  readonly assetRef: AssetRef;
  readonly workspaceId: string;
  readonly sourceSnapshot: string | null;
  readonly analysisSignature: string;
  readonly status: 'reviewable' | 'reviewable-partial' | 'unresolved' | 'stale';
  readonly executionAllowed: false;
  readonly executionBlockers: readonly string[];
  readonly coverage: { readonly status: AssetReferenceAnalysis['status']; readonly global: false; readonly limitations: readonly string[] };
  readonly owners: readonly AssetReferenceOwner[];
  readonly entries: readonly AssetDetachmentEntry[];
  readonly carriers: readonly { readonly ownerId: string; readonly locator: string; readonly proposal: 'synchronize-after-images' | 'included-in-card' | 'unresolved' }[];
  readonly dependencies: AssetReferenceAnalysis['dependencies'];
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
  readonly summary: { readonly owners: number; readonly occurrences: number; readonly markers: number; readonly removedBlocks: number; readonly retainedCards: number; readonly unresolved: number; readonly filesDeleted: 0 };
}

const unsupported = (reason: string): AssetDetachmentProposal => ({ kind: 'unsupported', reason });
const policies: readonly string[] = ['keep-marker', 'remove-block'];

/** Pure projection. No storage port, write, transformed Workspace or execution capability. */
export function planAssetDetachment(input: AssetDetachmentPlanInput): AssetDetachmentPlan {
  const { snapshot, assetRef } = input;
  const analysis = structuredClone(input.analysis);
  const blockers: string[] = [];
  const warnings = ['La identidad solo corresponde al snapshot aportado, no a una revisión física ni CAS.', 'Vista previa: D01/D02 no implementados; nunca autoriza ejecutar, desvincular ni purgar.'];
  let status: AssetDetachmentPlan['status'] = 'reviewable';
  const sourceSnapshot = analysis.sourceSnapshot;
  const finish = (proposed: readonly AssetDetachmentEntry[]): AssetDetachmentPlan => {
    const entries = proposed.length === 0 && (status === 'stale' || status === 'unresolved')
      ? analysis.occurrences.map((entry): AssetDetachmentEntry => ({ ...entry, decisionKey: entry.id, policy: null, proposal: unsupported(blockers[0] ?? 'Análisis sin validar.') })) : proposed;
    return ({
    assetRef, workspaceId: snapshot.id, sourceSnapshot, analysisSignature: JSON.stringify(analysis), status, executionAllowed: false,
    executionBlockers: ['D01: coordinación y revisión fiable no disponibles.', 'D02: aplicación recuperable no implementada.', 'La cobertura externa y los bytes no están acreditados.'],
    coverage: { status: analysis.status, global: false, limitations: [...warnings, ...analysis.issues.map((issue) => issue.detail)] },
    owners: analysis.owners, entries,
    carriers: analysis.carriers.map((carrier) => {
      const uses = entries.filter((entry) => entry.ownerId === carrier.ownerId);
      return { ...carrier, proposal: uses.some((entry) => entry.proposal.kind === 'retire-card') && !uses.some((entry) => entry.proposal.kind === 'unsupported') ? 'included-in-card' as const
        : uses.length > 0 && uses.every((entry) => entry.proposal.kind === 'keep-marker' || entry.proposal.kind === 'remove-block') ? 'synchronize-after-images' as const : 'unresolved' as const };
    }), dependencies: analysis.dependencies, warnings, blockers: [...new Set(blockers)],
    summary: { owners: analysis.owners.length, occurrences: entries.length, markers: entries.filter((entry) => entry.proposal.kind === 'keep-marker').length,
      removedBlocks: entries.filter((entry) => entry.proposal.kind === 'remove-block').length, retainedCards: new Set(entries.filter((entry) => entry.proposal.kind === 'retire-card').map((entry) => entry.ownerId)).size,
      unresolved: entries.filter((entry) => entry.proposal.kind === 'unsupported').length, filesDeleted: 0 },
    });
  };
  if (!isValidAssetRef(assetRef) || !assetRef.startsWith('assets/') || !validateWorkspace(snapshot).ok) {
    status = 'unresolved'; blockers.push('Snapshot o referencia inválidos.'); return finish([]);
  }
  if (sourceSnapshot !== null && (sourceSnapshot !== JSON.stringify(snapshot) || analysis.ref !== assetRef || analysis.workspaceId !== snapshot.id)) {
    status = 'stale'; blockers.push('El snapshot o Asset cambió: vuelve a analizar y recalcular; no reutilices decisiones.'); return finish([]);
  }
  if (sourceSnapshot === null) { status = 'unresolved'; blockers.push('El análisis no acredita un snapshot de origen.'); return finish([]); }
  if (input.exceptions && input.exceptions.sourceSnapshot !== sourceSnapshot) {
    status = 'stale'; blockers.push('Las excepciones pertenecen a otro snapshot. Recalcula y revísalas.'); return finish([]);
  }
  const fresh = analyzeAssetReferences({ workspace: snapshot, ref: assetRef,
    unverified: analysis.issues.filter((issue) => issue.kind === 'unverified').map((issue) => issue.detail), dependencies: analysis.dependencies });
  if (JSON.stringify(fresh) !== JSON.stringify(analysis)) {
    status = 'unresolved'; blockers.push('El análisis no coincide con el snapshot; hay identidades o referencias ambiguas.'); return finish([]);
  }
  const policy = input.noteImagePolicy ?? 'keep-marker';
  if (!policies.includes(policy)) { status = 'unresolved'; blockers.push('Política de imagen no admitida.'); return finish([]); }
  const decisions = new Map<string, NoteImagePolicy>();
  const ambiguousDecisions = new Set<string>();
  for (const exception of input.exceptions?.values ?? []) {
    const found = analysis.occurrences.find((entry) => entry.id === exception.occurrenceId);
    if (!found || !['rich-image', 'markdown-image'].includes(found.kind) || decisions.has(exception.occurrenceId) || !policies.includes(exception.policy)) {
      blockers.push('Una excepción tiene identidad ambigua, duplicada, no editorial o desconocida.');
      ambiguousDecisions.add(exception.occurrenceId);
    } else decisions.set(exception.occurrenceId, exception.policy);
  }
  if (analysis.status === 'partial') warnings.push('Cobertura parcial: los usos conocidos no demuestran ausencia de otros usos.');
  if (['error', 'unsupported'].includes(analysis.status)) blockers.push('El análisis contiene datos no interpretables o no soportados.');
  if (analysis.dependencies.length > 0) blockers.push('Hay dependencias externas sin transformación de retirada definida.');
  const entries = analysis.occurrences.map((occurrence): AssetDetachmentEntry => {
    const owner = analysis.owners.find((candidate) => candidate.id === occurrence.ownerId);
    const card: Card | undefined = owner?.collection === 'active' ? snapshot.cards.find((candidate) => candidate.id === owner.cardId)
      : owner?.collection === 'archive' ? snapshot.archive?.find((entry) => entry.card.id === owner.cardId)?.card
        : snapshot.trash?.find((entry) => entry.card.id === owner?.cardId)?.card;
    const type = snapshot.cardTypes.find((candidate) => candidate.id === card?.typeId);
    const selectedPolicy = ['rich-image', 'markdown-image'].includes(occurrence.kind) ? decisions.get(occurrence.id) ?? policy : null;
    let proposal: AssetDetachmentProposal = unsupported('Esta familia de referencia no tiene transformación de retirada definida.');
    if (card && type && (occurrence.kind === 'image-card' || occurrence.kind === 'document-card')) {
      const independent = (card.assetRefs?.length ?? 0) === 1 && card.assetRefs?.[0] === assetRef
        && !type.fields.some((field) => field.kind === 'asset' && card.fields[field.key] !== undefined)
        && !parseNoteBlocks(card.content ?? '').some((block) => block.kind === 'image') && richTextImageRefs(card.contentDocument).length === 0;
      proposal = independent && (occurrence.kind === 'image-card' || /\.pdf$/i.test(assetRef))
        ? { kind: 'retire-card', state: { kind: 'retired', resourceKind: occurrence.kind === 'image-card' ? 'image' : 'pdf' } }
        : unsupported('U2-A exige una tarjeta sin otras referencias cargables: primario/recursos secundarios o tipo PDF no acreditados.');
    } else if (card && type?.base === 'note' && occurrence.kind === 'rich-image') {
      const match = /^contentDocument\.blocks:(\d+)$/.exec(occurrence.locator);
      const block = match ? card.contentDocument?.blocks[Number(match[1])] : undefined;
      if (block?.type !== 'image' || block.assetRef !== assetRef) proposal = unsupported('No se puede identificar de forma fiable el bloque en este snapshot.');
      else if (selectedPolicy === 'remove-block') proposal = { kind: 'remove-block', loss: 'image-and-own-caption' };
      else if (block.caption?.some((inline) => inline.type === 'link')) proposal = unsupported('El marcador U2-B no admite enlaces en su leyenda; no se quitará el bloque automáticamente.');
      else proposal = { kind: 'keep-marker', marker: {
        type: 'retired-image', alt: block.alt,
        ...(block.caption === undefined ? {} : { caption: structuredClone(block.caption).filter((inline) => inline.type !== 'link') }),
        ...(block.captionPolicy === undefined ? {} : { captionPolicy: block.captionPolicy }),
        ...(block.accessibilityIntent === undefined ? {} : { accessibilityIntent: block.accessibilityIntent }),
        ...(block.size === undefined ? {} : { size: block.size }), ...(block.alignment === undefined ? {} : { alignment: block.alignment }),
      } };
    } else if (occurrence.kind === 'markdown-image') proposal = unsupported('La imagen Markdown está localizada, pero falta un contrato de transformación de rango y leyenda sin pérdida.');
    if (ambiguousDecisions.has(occurrence.id)) proposal = unsupported('La excepción de esta aparición es ambigua; vuelve a decidir sobre una identidad única.');
    if (proposal.kind === 'unsupported') blockers.push(proposal.reason);
    return { ...occurrence, decisionKey: occurrence.id, policy: selectedPolicy, proposal };
  });
  if (entries.some((entry) => entry.proposal.kind === 'remove-block')) warnings.push('La política remove-block quitaría la imagen y su leyenda propia; nunca modifica bloques vecinos.');
  if (blockers.length > 0) status = 'unresolved';
  else if (analysis.status === 'partial') status = 'reviewable-partial';
  return finish(entries);
}

/** Observation only, without reading a backend or rebinding old exception keys. */
export function isAssetDetachmentPlanCurrent(plan: AssetDetachmentPlan, snapshot: Workspace, analysis: AssetReferenceAnalysis): boolean {
  return plan.workspaceId === snapshot.id && plan.sourceSnapshot === JSON.stringify(snapshot) && plan.analysisSignature === JSON.stringify(analysis);
}
