import { failure, isNonBlankString, isRecord, issue, resultOf } from '../errors';
import type { DomainIssue, ValidationResult } from '../errors';
import { isValidId } from '../ids';
import type { BoardId, CardId } from '../ids';
import type { GridConfig, GridSize } from '../layouts/grid';
import type { BoardLayout, CardPlacement } from '../layouts/layout';
import { addGroup, findFreeSpace } from '../layouts/operations';
import { collectRelationIssues } from '../relations/relation';
import type { Relation } from '../relations/relation';
import { validateWorkspace } from '../workspace/workspace';
import type { Workspace } from '../workspace/workspace';
import { validateCard } from './card';
import {
  captionPositions, cardIconNames, connectorArrows, connectorDashes, connectorDirections, contentLayouts, contentVisibilities, frameOverrides, shapeFills, shapeKinds, shapeStrokes, shapeStrokeWidths, textSizes,
  floatingTextAlignments, floatingTextColors, type Card, type CaptionPosition, type CardIconName, type ConnectorArrows, type ConnectorDash, type ConnectorDirection, type ContentLayout, type ContentVisibility, type FloatingTextAlign, type FloatingTextColor, type FrameOverride, type ShapeFill, type ShapeKind, type ShapeStroke, type ShapeStrokeWidth, type TextSize,
} from './card';
import type { RichTextInline } from '../rich-text/rich-text';

export interface DeleteCardOptions {
  /** Por defecto no permite borrar una tarjeta conectada; cascade elimina sus vínculos explícitamente. */
  readonly relations?: 'restrict' | 'cascade';
}

/** Borrado global atómico en memoria. No elimina assets ni archivos (ADR 0005). */
export function deleteCard(workspace: Workspace, cardId: CardId, options: DeleteCardOptions = {}): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isRecord(options)) return failure([issue('invalid-value', 'options', 'Debe ser un objeto de opciones.')]);
  const policy = options.relations === undefined ? 'restrict' : options.relations;
  if (policy !== 'restrict' && policy !== 'cascade') {
    return failure([issue('invalid-value', 'options.relations', 'Debe ser restrict o cascade.')]);
  }
  if (!isValidId(cardId)) return failure([issue('invalid-id', 'cardId', 'Identificador de tarjeta inválido.')]);
  if (!workspace.cards.some(card => card.id === cardId)) {
    return failure([issue('missing-reference', 'cardId', 'La tarjeta no existe en el workspace.')]);
  }
  const incident = workspace.relations.some(relation => relation.from === cardId || relation.to === cardId);
  if (incident && policy === 'restrict') {
    return failure([issue('card-has-relations', 'cardId', 'La tarjeta tiene relaciones; eliminarlas o usar cascade explícitamente.')]);
  }
  return resultOf({
    ...workspace,
    cards: workspace.cards.filter(card => card.id !== cardId).map((card) => {
      if (card.connectorStartCardId !== cardId && card.connectorEndCardId !== cardId) return card;
      const { connectorStartCardId, connectorEndCardId, ...rest } = card;
      return {
        ...rest,
        ...(connectorStartCardId === cardId ? {} : { connectorStartCardId }),
        ...(connectorEndCardId === cardId ? {} : { connectorEndCardId }),
      } as Card;
    }),
    relations: workspace.relations.filter(relation => relation.from !== cardId && relation.to !== cardId),
    boards: workspace.boards.map(board => board.cardIds.includes(cardId)
      ? { ...board, cardIds: board.cardIds.filter(member => member !== cardId) } : board),
    layouts: workspace.layouts.map(layout => layout.placements.some(placement => placement.cardId === cardId)
      ? { ...layout, placements: layout.placements.filter(placement => placement.cardId !== cardId) } : layout),
  }, []);
}

export interface AddCardOptions {
  /** Board existente donde se muestra la tarjeta. */
  readonly boardId: BoardId;
  /** Tamaño expandido inicial, en unidades de la grilla indicada. */
  readonly size: GridSize;
  readonly config: GridConfig;
}

/**
 * Agrega una tarjeta aportada por el llamador (con su ID) al workspace, al final del board y en el
 * primer hueco libre de su layout, expandida. Si el board aún no tenía layout, lo crea. No genera
 * IDs ni tipos: el tipo y el board deben existir (fase 7).
 */
export function addCard(workspace: Workspace, card: Card, options: AddCardOptions): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isRecord(options)) return failure([issue('invalid-value', 'options', 'Debe ser un objeto de opciones.')]);
  const input: unknown = card;
  if (!isRecord(input)) return failure([issue('invalid-value', 'card', 'Debe ser un objeto.')]);
  if (workspace.cards.some((existing) => existing.id === card.id)) {
    return failure([issue('duplicate-id', 'card.id', `Ya existe una tarjeta "${card.id}".`)]);
  }
  if (!isValidId(card.typeId)) return failure([issue('invalid-id', 'card.typeId', 'Identificador de tipo inválido.')]);
  const type = workspace.cardTypes.find((candidate) => candidate.id === card.typeId);
  if (!type) return failure([issue('missing-reference', 'card.typeId', `No existe el tipo de tarjeta "${card.typeId}".`)]);
  const checked = validateCard(card, type);
  if (!checked.ok) return failure(checked.issues);
  const { boardId } = options;
  if (!isValidId(boardId)) return failure([issue('invalid-id', 'options.boardId', 'Identificador de board inválido.')]);
  if (!workspace.boards.some((board) => board.id === boardId)) {
    return failure([issue('missing-reference', 'options.boardId', `No existe el board "${boardId}".`)]);
  }
  const current = workspace.layouts.find((layout) => layout.boardId === boardId);
  const layout: BoardLayout = current ?? { boardId, placements: [] };
  const spot = findFreeSpace(layout, options.size, options.config);
  if (!spot.ok) return failure(spot.issues);
  const placement: CardPlacement = {
    cardId: card.id, rect: { x: spot.value.x, y: spot.value.y, w: options.size.w, h: options.size.h }, display: 'expanded',
  };
  const placed: BoardLayout = { ...layout, placements: [...layout.placements, placement] };
  return validateWorkspace({
    ...workspace,
    cards: [...workspace.cards, { ...card }],
    boards: workspace.boards.map((board) => (board.id === boardId ? { ...board, cardIds: [...board.cardIds, card.id] } : board)),
    layouts: current ? workspace.layouts.map((existing) => (existing === current ? placed : existing)) : [...workspace.layouts, placed],
  });
}

export interface PasteCardsInput {
  readonly boardId: BoardId;
  /** Tarjetas nuevas, con sus IDs ya asignados por quien llama: el dominio nunca los genera (ADR 0009). */
  readonly cards: readonly Card[];
  /** Relaciones nuevas entre esas tarjetas, con sus IDs ya asignados (ADR 0052: solo las internas al grupo). */
  readonly relations: readonly Relation[];
  /** Una colocación por cada tarjeta de `cards` (mismo `cardId`), con el desplazamiento ya decidido por quien llama. */
  readonly placements: readonly CardPlacement[];
  readonly config: GridConfig;
}

/**
 * Pegar o duplicar una selección (ADR 0052): da de alta un grupo de tarjetas, sus relaciones internas
 * y sus colocaciones en un solo tablero, todo o nada. No busca hueco ni genera IDs — quien llama ya
 * decidió dónde va cada una (p. ej. con `findFreeSpace` sobre el contorno del grupo) y con qué
 * identificador; esta función solo valida el conjunto y lo aplica.
 */
export function pasteCardsOnBoard(workspace: Workspace, input: PasteCardsInput): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isRecord(input)) return failure([issue('invalid-value', 'input', 'Debe ser un objeto.')]);
  const { boardId, cards, relations, placements, config } = input;
  if (!isValidId(boardId)) return failure([issue('invalid-id', 'boardId', 'Identificador de tablero inválido.')]);
  if (!workspace.boards.some((board) => board.id === boardId)) {
    return failure([issue('missing-reference', 'boardId', `No existe el tablero "${boardId}".`)]);
  }
  if (!Array.isArray(cards) || cards.length === 0) return failure([issue('invalid-value', 'cards', 'Debe haber al menos una tarjeta.')]);
  const issues: DomainIssue[] = [];
  for (const card of cards) {
    const raw: unknown = card;
    if (!isRecord(raw)) { issues.push(issue('invalid-value', 'cards', 'Cada tarjeta debe ser un objeto.')); continue; }
    if (workspace.cards.some((existing) => existing.id === card.id)) {
      issues.push(issue('duplicate-id', 'cards', `Ya existe una tarjeta "${card.id}".`));
      continue;
    }
    const type = workspace.cardTypes.find((candidate) => candidate.id === card.typeId);
    if (!type) { issues.push(issue('missing-reference', 'cards', `No existe el tipo de tarjeta "${card.typeId}".`)); continue; }
    const checked = validateCard(card, type);
    if (!checked.ok) issues.push(...checked.issues);
  }
  if (!Array.isArray(placements) || placements.length !== cards.length) {
    issues.push(issue('invalid-value', 'placements', 'Debe haber una colocación por cada tarjeta.'));
  } else {
    const missing = cards.filter((card) => !placements.some((placement) => placement.cardId === card.id));
    issues.push(...missing.map((card) => issue('missing-reference', 'placements', `Falta colocación para "${card.id}".`)));
  }
  if (!Array.isArray(relations)) issues.push(issue('invalid-value', 'relations', 'Debe ser una lista.'));
  else relations.forEach((relation, index) => collectRelationIssues(relation, `relations[${index}]`, issues));
  if (issues.length > 0) return failure(issues);
  const current = workspace.layouts.find((layout) => layout.boardId === boardId);
  const layout: BoardLayout = current ?? { boardId, placements: [] };
  const placed = addGroup(layout, placements, config);
  if (!placed.ok) return failure([...placed.issues]);
  return validateWorkspace({
    ...workspace,
    cards: [...workspace.cards, ...cards],
    relations: [...workspace.relations, ...relations],
    boards: workspace.boards.map((board) => (board.id === boardId ? { ...board, cardIds: [...board.cardIds, ...cards.map((card) => card.id)] } : board)),
    layouts: current ? workspace.layouts.map((existing) => (existing === current ? placed.value : existing)) : [...workspace.layouts, placed.value],
  });
}

/** Cambios editables desde el prototipo: título y cuerpo Markdown. */
export interface CardContentChanges {
  /** Un título en blanco elimina el título (es opcional); cualquier otro se guarda tal cual. */
  readonly title?: string;
  /** `null` vuelve al título plano/ausente; al establecerlo elimina `title`. */
  readonly titleRichText?: readonly RichTextInline[] | null;
  /** Markdown opaco: se guarda literal, también vacío. */
  readonly content?: string;
}

const editableCardKeys: readonly string[] = ['title', 'titleRichText', 'content'];

/** Edita título y Markdown sin tocar campos, assets, representación ni relaciones. */
export function updateCard(workspace: Workspace, cardId: CardId, changes: CardContentChanges): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isValidId(cardId)) return failure([issue('invalid-id', 'cardId', 'Identificador de tarjeta inválido.')]);
  const card = workspace.cards.find((candidate) => candidate.id === cardId);
  if (!card) return failure([issue('missing-reference', 'cardId', 'La tarjeta no existe en el workspace.')]);
  const input: unknown = changes;
  if (!isRecord(input)) return failure([issue('invalid-value', 'changes', 'Debe ser un objeto de cambios.')]);
  const issues: DomainIssue[] = Object.keys(input)
    .filter((key) => !editableCardKeys.includes(key))
    .map((key) => issue('unknown-property', `changes.${key}`, 'Solo se pueden editar el título y el contenido.'));
  for (const key of ['title', 'content'] as const) {
    if (Object.hasOwn(input, key) && typeof input[key] !== 'string') {
      issues.push(issue('invalid-value', `changes.${key}`, 'Debe ser texto.'));
    }
  }
  if (Object.hasOwn(input, 'titleRichText') && input.titleRichText !== null && !Array.isArray(input.titleRichText)) {
    issues.push(issue('invalid-value', 'changes.titleRichText', 'Debe ser contenido inline o null.'));
  }
  if (Object.hasOwn(input, 'title') && Object.hasOwn(input, 'titleRichText')) {
    issues.push(issue('invalid-value', 'changes.titleRichText', 'Cambia una sola representación del título por operación.'));
  }
  if (issues.length > 0) return failure(issues);
  const { title, titleRichText, ...untitled } = card;
  const nextTitle = changes.title === undefined ? title : changes.title;
  const edited: Card = {
    ...untitled,
    ...(changes.titleRichText !== undefined
      ? changes.titleRichText === null || changes.titleRichText.length === 0 ? {} : { titleRichText: changes.titleRichText }
      : titleRichText !== undefined ? { titleRichText }
        : isNonBlankString(nextTitle) ? { title: nextTitle } : {}),
    ...(changes.content === undefined ? {} : { content: changes.content }),
  };
  return validateWorkspace({ ...workspace, cards: workspace.cards.map((candidate) => (candidate === card ? edited : candidate)) });
}

export interface CardAppearanceChanges {
  readonly icon?: CardIconName | null;
  readonly boardTargetId?: BoardId | null;
  /** Excepción a la preferencia global de marco (ADR 0049); `null` vuelve a seguirla. */
  readonly frameOverride?: FrameOverride | null;
  /** Tamaño semántico del título/cuerpo (ADR 0050); `null` vuelve a `'medium'` (ausente). */
  readonly titleSize?: TextSize | null;
  readonly bodySize?: TextSize | null;
  /** Posición de la leyenda de imágenes intercaladas (ADR 0051); `null` vuelve a `'bottom'` (ausente). */
  readonly captionPosition?: CaptionPosition | null;
  readonly titleVisibility?: ContentVisibility | null;
  readonly bodyVisibility?: ContentVisibility | null;
  readonly contentLayout?: ContentLayout | null;
  readonly textAlign?: FloatingTextAlign | null;
  readonly textColor?: FloatingTextColor | null;
  readonly shapeKind?: ShapeKind | null;
  readonly shapeFill?: ShapeFill | null;
  readonly shapeStroke?: ShapeStroke | null;
  readonly shapeStrokeWidth?: ShapeStrokeWidth | null;
  readonly connectorColor?: ShapeStroke | null;
  readonly connectorWidth?: ShapeStrokeWidth | null;
  readonly connectorDash?: ConnectorDash | null;
  readonly connectorArrows?: ConnectorArrows | null;
  readonly connectorDirection?: ConnectorDirection | null;
  readonly connectorStartCardId?: CardId | null;
  readonly connectorEndCardId?: CardId | null;
}

const appearanceKeys: readonly string[] = ['icon', 'boardTargetId', 'frameOverride', 'titleSize', 'bodySize', 'captionPosition', 'titleVisibility', 'bodyVisibility', 'contentLayout', 'textAlign', 'textColor', 'shapeKind', 'shapeFill', 'shapeStroke', 'shapeStrokeWidth', 'connectorColor', 'connectorWidth', 'connectorDash', 'connectorArrows', 'connectorDirection', 'connectorStartCardId', 'connectorEndCardId'];

/** Cambia icono, destino de tablero, excepción de marco, tamaños de texto y posición de leyenda sin abrir el contenido de la tarjeta (ADR 0046, ADR 0049, ADR 0050, ADR 0051). */
export function updateCardAppearance(workspace: Workspace, cardId: CardId, changes: CardAppearanceChanges): ValidationResult<Workspace> {
  const source = validateWorkspace(workspace);
  if (!source.ok) return source;
  if (!isValidId(cardId)) return failure([issue('invalid-id', 'cardId', 'Identificador de tarjeta inválido.')]);
  const card = workspace.cards.find((candidate) => candidate.id === cardId);
  if (!card) return failure([issue('missing-reference', 'cardId', 'La tarjeta no existe en el workspace.')]);
  if (!isRecord(changes)) return failure([issue('invalid-value', 'changes', 'Debe ser un objeto de cambios.')]);
  const unknown = Object.keys(changes).filter((key) => !appearanceKeys.includes(key));
  if (unknown.length > 0) return failure(unknown.map((key) => issue('unknown-property', `changes.${key}`, 'Propiedad no editable.')));
  const nextIcon = changes.icon;
  const nextTarget = changes.boardTargetId;
  const nextFrame = changes.frameOverride;
  const nextTitleSize = changes.titleSize;
  const nextBodySize = changes.bodySize;
  const nextCaptionPosition = changes.captionPosition;
  const nextTitleVisibility = changes.titleVisibility;
  const nextBodyVisibility = changes.bodyVisibility;
  const nextContentLayout = changes.contentLayout;
  const nextTextAlign = changes.textAlign;
  const nextTextColor = changes.textColor;
  const nextShapeKind = changes.shapeKind;
  const nextShapeFill = changes.shapeFill;
  const nextShapeStroke = changes.shapeStroke;
  const nextShapeStrokeWidth = changes.shapeStrokeWidth;
  const nextConnectorColor = changes.connectorColor;
  const nextConnectorWidth = changes.connectorWidth;
  const nextConnectorDash = changes.connectorDash;
  const nextConnectorArrows = changes.connectorArrows;
  const nextConnectorDirection = changes.connectorDirection;
  const nextConnectorStart = changes.connectorStartCardId;
  const nextConnectorEnd = changes.connectorEndCardId;
  if (nextIcon !== undefined && nextIcon !== null && !cardIconNames.includes(nextIcon as CardIconName)) {
    return failure([issue('invalid-value', 'changes.icon', 'Icono desconocido.')]);
  }
  if (nextTarget !== undefined && nextTarget !== null
    && !workspace.boards.some((board) => board.id === nextTarget)) {
    return failure([issue('missing-reference', 'changes.boardTargetId', 'El tablero destino no existe.')]);
  }
  if (nextFrame !== undefined && nextFrame !== null && !frameOverrides.includes(nextFrame as FrameOverride)) {
    return failure([issue('invalid-value', 'changes.frameOverride', 'Debe ser "visible" u "hidden".')]);
  }
  if (nextTitleSize !== undefined && nextTitleSize !== null && !textSizes.includes(nextTitleSize as TextSize)) {
    return failure([issue('invalid-value', 'changes.titleSize', 'Debe ser "small", "medium" o "large".')]);
  }
  if (nextBodySize !== undefined && nextBodySize !== null && !textSizes.includes(nextBodySize as TextSize)) {
    return failure([issue('invalid-value', 'changes.bodySize', 'Debe ser "small", "medium" o "large".')]);
  }
  if (nextCaptionPosition !== undefined && nextCaptionPosition !== null && !captionPositions.includes(nextCaptionPosition as CaptionPosition)) {
    return failure([issue('invalid-value', 'changes.captionPosition', 'Debe ser "bottom", "top", "left" o "right".')]);
  }
  if (nextTitleVisibility !== undefined && nextTitleVisibility !== null && !contentVisibilities.includes(nextTitleVisibility as ContentVisibility)) return failure([issue('invalid-value', 'changes.titleVisibility', 'Visibilidad desconocida.')]);
  if (nextBodyVisibility !== undefined && nextBodyVisibility !== null && !contentVisibilities.includes(nextBodyVisibility as ContentVisibility)) return failure([issue('invalid-value', 'changes.bodyVisibility', 'Visibilidad desconocida.')]);
  if (nextContentLayout !== undefined && nextContentLayout !== null && !contentLayouts.includes(nextContentLayout as ContentLayout)) return failure([issue('invalid-value', 'changes.contentLayout', 'Composición desconocida.')]);
  if (nextTextAlign !== undefined && nextTextAlign !== null && !floatingTextAlignments.includes(nextTextAlign as FloatingTextAlign)) {
    return failure([issue('invalid-value', 'changes.textAlign', 'Alineación desconocida.')]);
  }
  if (nextTextColor !== undefined && nextTextColor !== null && !floatingTextColors.includes(nextTextColor as FloatingTextColor)) {
    return failure([issue('invalid-value', 'changes.textColor', 'Color desconocido.')]);
  }
  if (nextShapeKind !== undefined && nextShapeKind !== null && !shapeKinds.includes(nextShapeKind as ShapeKind)) return failure([issue('invalid-value', 'changes.shapeKind', 'Forma desconocida.')]);
  if (nextShapeFill !== undefined && nextShapeFill !== null && !shapeFills.includes(nextShapeFill as ShapeFill)) return failure([issue('invalid-value', 'changes.shapeFill', 'Relleno desconocido.')]);
  if (nextShapeStroke !== undefined && nextShapeStroke !== null && !shapeStrokes.includes(nextShapeStroke as ShapeStroke)) return failure([issue('invalid-value', 'changes.shapeStroke', 'Borde desconocido.')]);
  if (nextShapeStrokeWidth !== undefined && nextShapeStrokeWidth !== null && !shapeStrokeWidths.includes(nextShapeStrokeWidth as ShapeStrokeWidth)) return failure([issue('invalid-value', 'changes.shapeStrokeWidth', 'Grosor desconocido.')]);
  if (nextConnectorColor !== undefined && nextConnectorColor !== null && !shapeStrokes.includes(nextConnectorColor as ShapeStroke)) return failure([issue('invalid-value', 'changes.connectorColor', 'Color desconocido.')]);
  if (nextConnectorWidth !== undefined && nextConnectorWidth !== null && !shapeStrokeWidths.includes(nextConnectorWidth as ShapeStrokeWidth)) return failure([issue('invalid-value', 'changes.connectorWidth', 'Grosor desconocido.')]);
  if (nextConnectorDash !== undefined && nextConnectorDash !== null && !connectorDashes.includes(nextConnectorDash as ConnectorDash)) return failure([issue('invalid-value', 'changes.connectorDash', 'Trazo desconocido.')]);
  if (nextConnectorArrows !== undefined && nextConnectorArrows !== null && !connectorArrows.includes(nextConnectorArrows as ConnectorArrows)) return failure([issue('invalid-value', 'changes.connectorArrows', 'Puntas desconocidas.')]);
  if (nextConnectorDirection !== undefined && nextConnectorDirection !== null && !connectorDirections.includes(nextConnectorDirection as ConnectorDirection)) return failure([issue('invalid-value', 'changes.connectorDirection', 'Dirección desconocida.')]);
  for (const [key, value] of [['connectorStartCardId', nextConnectorStart], ['connectorEndCardId', nextConnectorEnd]] as const) {
    if (value !== undefined && value !== null && (!isValidId(value) || value === cardId || !workspace.cards.some((candidate) => candidate.id === value))) {
      return failure([issue(value === cardId ? 'invalid-value' : 'missing-reference', `changes.${key}`, 'El anclaje debe ser otra tarjeta existente.')]);
    }
  }
  const {
    icon: _icon, boardTargetId: _target, frameOverride: _frame, titleSize: _titleSize, bodySize: _bodySize,
    captionPosition: _captionPosition, titleVisibility: _titleVisibility, bodyVisibility: _bodyVisibility, contentLayout: _contentLayout, textAlign: _textAlign, textColor: _textColor,
    shapeKind: _shapeKind, shapeFill: _shapeFill, shapeStroke: _shapeStroke, shapeStrokeWidth: _shapeStrokeWidth,
    connectorColor: _connectorColor, connectorWidth: _connectorWidth, connectorDash: _connectorDash, connectorArrows: _connectorArrows, connectorDirection: _connectorDirection,
    connectorStartCardId: _connectorStartCardId, connectorEndCardId: _connectorEndCardId, ...base
  } = card;
  const edited: Card = {
    ...base,
    ...(nextIcon === undefined ? (card.icon === undefined ? {} : { icon: card.icon }) : nextIcon === null ? {} : { icon: nextIcon as CardIconName }),
    ...(nextTarget === undefined ? (card.boardTargetId === undefined ? {} : { boardTargetId: card.boardTargetId })
      : nextTarget === null ? {} : { boardTargetId: nextTarget as BoardId }),
    ...(nextFrame === undefined ? (card.frameOverride === undefined ? {} : { frameOverride: card.frameOverride })
      : nextFrame === null ? {} : { frameOverride: nextFrame as FrameOverride }),
    ...(nextTitleSize === undefined ? (card.titleSize === undefined ? {} : { titleSize: card.titleSize })
      : nextTitleSize === null ? {} : { titleSize: nextTitleSize as TextSize }),
    ...(nextBodySize === undefined ? (card.bodySize === undefined ? {} : { bodySize: card.bodySize })
      : nextBodySize === null ? {} : { bodySize: nextBodySize as TextSize }),
    ...(nextCaptionPosition === undefined ? (card.captionPosition === undefined ? {} : { captionPosition: card.captionPosition })
      : nextCaptionPosition === null ? {} : { captionPosition: nextCaptionPosition as CaptionPosition }),
    ...(nextTitleVisibility === undefined ? (card.titleVisibility === undefined ? {} : { titleVisibility: card.titleVisibility }) : nextTitleVisibility === null ? {} : { titleVisibility: nextTitleVisibility as ContentVisibility }),
    ...(nextBodyVisibility === undefined ? (card.bodyVisibility === undefined ? {} : { bodyVisibility: card.bodyVisibility }) : nextBodyVisibility === null ? {} : { bodyVisibility: nextBodyVisibility as ContentVisibility }),
    ...(nextContentLayout === undefined ? (card.contentLayout === undefined ? {} : { contentLayout: card.contentLayout }) : nextContentLayout === null ? {} : { contentLayout: nextContentLayout as ContentLayout }),
    ...(nextTextAlign === undefined ? (card.textAlign === undefined ? {} : { textAlign: card.textAlign })
      : nextTextAlign === null ? {} : { textAlign: nextTextAlign as FloatingTextAlign }),
    ...(nextTextColor === undefined ? (card.textColor === undefined ? {} : { textColor: card.textColor })
      : nextTextColor === null ? {} : { textColor: nextTextColor as FloatingTextColor }),
    ...(nextShapeKind === undefined ? (card.shapeKind === undefined ? {} : { shapeKind: card.shapeKind }) : nextShapeKind === null ? {} : { shapeKind: nextShapeKind as ShapeKind }),
    ...(nextShapeFill === undefined ? (card.shapeFill === undefined ? {} : { shapeFill: card.shapeFill }) : nextShapeFill === null ? {} : { shapeFill: nextShapeFill as ShapeFill }),
    ...(nextShapeStroke === undefined ? (card.shapeStroke === undefined ? {} : { shapeStroke: card.shapeStroke }) : nextShapeStroke === null ? {} : { shapeStroke: nextShapeStroke as ShapeStroke }),
    ...(nextShapeStrokeWidth === undefined ? (card.shapeStrokeWidth === undefined ? {} : { shapeStrokeWidth: card.shapeStrokeWidth }) : nextShapeStrokeWidth === null ? {} : { shapeStrokeWidth: nextShapeStrokeWidth as ShapeStrokeWidth }),
    ...(nextConnectorColor === undefined ? (card.connectorColor === undefined ? {} : { connectorColor: card.connectorColor }) : nextConnectorColor === null ? {} : { connectorColor: nextConnectorColor as ShapeStroke }),
    ...(nextConnectorWidth === undefined ? (card.connectorWidth === undefined ? {} : { connectorWidth: card.connectorWidth }) : nextConnectorWidth === null ? {} : { connectorWidth: nextConnectorWidth as ShapeStrokeWidth }),
    ...(nextConnectorDash === undefined ? (card.connectorDash === undefined ? {} : { connectorDash: card.connectorDash }) : nextConnectorDash === null ? {} : { connectorDash: nextConnectorDash as ConnectorDash }),
    ...(nextConnectorArrows === undefined ? (card.connectorArrows === undefined ? {} : { connectorArrows: card.connectorArrows }) : nextConnectorArrows === null ? {} : { connectorArrows: nextConnectorArrows as ConnectorArrows }),
    ...(nextConnectorDirection === undefined ? (card.connectorDirection === undefined ? {} : { connectorDirection: card.connectorDirection }) : nextConnectorDirection === null ? {} : { connectorDirection: nextConnectorDirection as ConnectorDirection }),
    ...(nextConnectorStart === undefined ? (card.connectorStartCardId === undefined ? {} : { connectorStartCardId: card.connectorStartCardId }) : nextConnectorStart === null ? {} : { connectorStartCardId: nextConnectorStart as CardId }),
    ...(nextConnectorEnd === undefined ? (card.connectorEndCardId === undefined ? {} : { connectorEndCardId: card.connectorEndCardId }) : nextConnectorEnd === null ? {} : { connectorEndCardId: nextConnectorEnd as CardId }),
  };
  return validateWorkspace({ ...workspace, cards: workspace.cards.map((candidate) => candidate === card ? edited : candidate) });
}
