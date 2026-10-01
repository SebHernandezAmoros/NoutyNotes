import { addCardTag, addNoteImage, assetsOf, connectCards, disconnectCards, editCardAppearance, editCardContent, moveCardOnBoard, removeCardTag, resizeCardOnBoard, setCardLink, updateConnection } from '@noutynotes/application';
import type { WorkspaceStorageResult } from '@noutynotes/application';
import { cardIconNames, linkUrlField } from '@noutynotes/domain';
import type { BoardId, Card, CardDisplayMode, CardId, CardPlacement, RelationArrow, RelationId, Workspace } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { t } from '../i18n';
import { formatCreated } from './dates';
import { describeFailure } from '../session/messages';
import { pickImageFile, supportsImageImport } from '../session/imageFiles';
import { useWorkspaceSession } from '../session/WorkspaceSession';
import { cardTitle } from './Board';
import { applyListCommand, normalizeListChange, toggleChecklistLine } from './markdownLists';
import { NoteBlocksEditor } from './NoteBlocksEditor';
import { openLink } from './openLink';
import type { ListKind, TextSelection } from './markdownLists';
import type { ActionSuccess, RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: ActionSuccess, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

interface CardInspectorProps {
  readonly workspace: Workspace;
  readonly boardId: BoardId;
  readonly card: Card;
  readonly placement: CardPlacement | undefined;
  readonly run: Run;
  readonly onDraftChange: (draft: { cardId: CardId; title: string; content: string }) => void;
  readonly flushPendingText: () => Promise<boolean>;
  readonly onClose: () => void;
  /** Representación y Papelera (ADR 0014, ADR 0015); los mismos caminos que la barra de la tarjeta. */
  readonly onDisplay: (display: CardDisplayMode) => void;
  readonly onTrash: () => void;
  /** Archivar (ADR 0023): sale de los tableros sin destruirse. */
  readonly onArchive: () => void;
  /** Selección múltiple (ADR 0025): empieza con esta tarjeta; en táctil es la única entrada. */
  readonly onSelectMany?: (() => void) | undefined;
  /** En la hoja móvil, la barra de la hoja ya muestra el título y «Cerrar»: no se repiten aquí. */
  readonly inSheet?: boolean;
  /** Imágenes intercaladas en notas, por ruta (ADR 0021). */
  readonly noteImages: ReadonlyMap<string, string>;
  /** Tipografía de las notas (ADR 0030), ya resuelta para esta plataforma. */
  readonly noteFontFamily?: string | undefined;
  /** Editor enfocado (ADR 0021): ampliar o volver al tablero. En la hoja móvil lo ofrece su barra. */
  readonly focused?: boolean;
  readonly onToggleFocus?: () => void;
  readonly onOpenBoard?: (boardId: BoardId) => void;
}

const displayKeys: readonly { display: CardDisplayMode; labelKey: 'inspector.display.expanded' | 'inspector.display.collapsed' | 'inspector.display.minimized' }[] = [
  { display: 'expanded', labelKey: 'inspector.display.expanded' },
  { display: 'collapsed', labelKey: 'inspector.display.collapsed' },
  { display: 'minimized', labelKey: 'inspector.display.minimized' },
];

const moveKeys = [
  { label: '←', nameKey: 'inspector.move.left', dx: -1, dy: 0 },
  { label: '→', nameKey: 'inspector.move.right', dx: 1, dy: 0 },
  { label: '↑', nameKey: 'inspector.move.up', dx: 0, dy: -1 },
  { label: '↓', nameKey: 'inspector.move.down', dx: 0, dy: 1 },
] as const;

const resizeKeys = [
  { labelKey: 'inspector.resize.width.label', nameKey: 'inspector.resize.width.name', dw: -1, dh: 0 },
  { labelKey: 'inspector.resize.widthPlus.label', nameKey: 'inspector.resize.widthPlus.name', dw: 1, dh: 0 },
  { labelKey: 'inspector.resize.height.label', nameKey: 'inspector.resize.height.name', dw: 0, dh: -1 },
  { labelKey: 'inspector.resize.heightPlus.label', nameKey: 'inspector.resize.heightPlus.name', dw: 0, dh: 1 },
] as const;

/**
 * Editor de la tarjeta seleccionada. Cada botón despacha un caso de uso; los límites y colisiones
 * los decide el motor de grilla y los errores se muestran tal como los devuelve.
 */
export function CardInspector({ workspace, boardId, card, placement, run, onDraftChange, flushPendingText, onClose, onDisplay, onTrash, onArchive, onSelectMany, inSheet = false, noteImages, noteFontFamily, focused = false, onToggleFocus, onOpenBoard }: CardInspectorProps) {
  const { mode } = useWorkspaceSession();
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [title, setTitle] = useState(card.title ?? '');
  const [content, setContent] = useState(card.content ?? '');
  const selectionRef = useRef<TextSelection>({ start: content.length, end: content.length });
  const [forcedSelection, setForcedSelection] = useState<TextSelection | undefined>();
  const dirty = title !== (card.title ?? '') || content !== (card.content ?? '');
  const changeTitle = (value: string) => {
    setTitle(value);
    if (mode === 'folder') onDraftChange({ cardId: card.id, title: value, content });
  };
  const changeContent = (value: string) => {
    const edit = normalizeListChange(content, value, selectionRef.current);
    const next = edit?.text ?? value;
    setContent(next);
    if (edit) setForcedSelection({ start: edit.caret, end: edit.caret });
    if (mode === 'folder') onDraftChange({ cardId: card.id, title, content: next });
  };
  const insertList = (kind: ListKind) => {
    const edit = applyListCommand(content, selectionRef.current, kind);
    setContent(edit.text);
    selectionRef.current = { start: edit.caret, end: edit.caret };
    setForcedSelection(selectionRef.current);
    if (mode === 'folder') onDraftChange({ cardId: card.id, title, content: edit.text });
  };
  // Etiquetas (ADR 0019): se guardan al momento, aparte del texto; lo escrito se normaliza (#Idea → idea).
  const [tagDraft, setTagDraft] = useState('');
  const addTag = () => {
    const input = tagDraft;
    void run((storage, id) => addCardTag(storage, id, card.id, input), 'action.tagAdded')
      .then((result) => { if (result.ok) setTagDraft(''); });
  };
  const removeTag = (tag: string) => {
    void run((storage, id) => removeCardTag(storage, id, card.id, tag), { key: 'action.tagRemoved', params: { tag } });
  };
  // Enlace (ADR 0020): la dirección se guarda al pulsar «Guardar enlace», normalizada; abrir usa el sistema.
  const linkKey = linkUrlField(workspace.cardTypes.find((type) => type.id === card.typeId));
  const savedLink = linkKey ? card.fields[linkKey] : undefined;
  const currentLink = typeof savedLink === 'string' ? savedLink : '';
  const [linkDraft, setLinkDraft] = useState(currentLink);
  // Si la dirección guardada cambia (otra tarjeta, o guardada normalizada), el borrador la sigue.
  const [linkBase, setLinkBase] = useState(currentLink);
  if (linkBase !== currentLink) {
    setLinkBase(currentLink);
    setLinkDraft(currentLink);
  }
  const saveLink = () => {
    const input = linkDraft;
    void run((storage, id) => setCardLink(storage, id, card.id, input), 'action.linkSaved')
      .then((result) => { if (result.ok) setLinkDraft(result.value); });
  };
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const open = () => {
    setLinkProblem(null);
    void openLink(currentLink).then((opened) => {
      if (!opened) setLinkProblem(t('inspector.link.openFailed', locale));
    });
  };
  // Contenido en orden (ADR 0021): mover, quitar o el texto alternativo cambian el borrador, como escribir.
  const changeBlocks = (next: string) => {
    setContent(next);
    if (mode === 'folder') onDraftChange({ cardId: card.id, title, content: next });
  };
  const blocksType = workspace.cardTypes.find((type) => type.id === card.typeId)?.base;
  const withBlocks = blocksType !== 'image' && blocksType !== 'section';
  const [imageProblem, setImageProblem] = useState<string | null>(null);
  // Insertar o reemplazar guarda enseguida el contenido del editor con la imagen (y el asset nuevo).
  const placeImage = async (place: { kind: 'insert'; caret?: number } | { kind: 'replace'; index: number }) => {
    setImageProblem(null);
    if (!supportsImageImport()) return setImageProblem(t('assets.error.noImagePicker', locale));
    let picked;
    try {
      picked = await pickImageFile();
    } catch {
      return setImageProblem(t('assets.error.imageReadFailed', locale));
    }
    if (!picked) return undefined;
    const file = picked;
    const draft = content;
    const result = await run((storage, id) => {
      const assets = assetsOf(storage);
      if (!assets) return Promise.resolve({ ok: false as const, issues: [{ code: 'invalid-asset' as const, path: 'storage', message: 'Este almacenamiento no guarda imágenes.' }] });
      return addNoteImage(storage, assets, id, card.id, { bytes: file.bytes, fileName: file.name, content: draft, place });
    }, place.kind === 'insert' ? { key: 'action.noteImageInserted', params: { name: file.name } } : { key: 'action.noteImageReplaced', params: { name: file.name } });
    if (result.ok) {
      setContent(result.value.content);
      if (mode === 'folder') onDraftChange({ cardId: card.id, title, content: result.value.content });
    } else {
      setImageProblem(describeFailure(result.issues, mode));
    }
    return undefined;
  };
  const toggleCheck = (line: number) => {
    const next = toggleChecklistLine(content, line);
    if (next !== null) {
      setContent(next);
      if (mode === 'folder') onDraftChange({ cardId: card.id, title, content: next });
    }
  };
  useEffect(() => {
    if (mode !== 'folder' || !dirty) return;
    const timer = setTimeout(() => { void flushPendingText(); }, 700);
    return () => clearTimeout(timer);
  }, [mode, dirty, title, content, flushPendingText]);
  useEffect(() => {
    if (Platform.OS !== 'web' || mode !== 'folder' || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [mode, dirty]);
  const titles = new Map(workspace.cards.map((other) => [other.id, cardTitle(other)]));
  const typeLabels = new Map(workspace.relationTypes.map((type) => [type.id, type.label]));
  const connected = workspace.relations.filter((relation) => relation.from === card.id || relation.to === card.id);
  const targets = workspace.cards.filter((other) => other.id !== card.id
    && !workspace.relations.some((relation) => relation.from === card.id && relation.to === other.id));
  // Con pocas tarjetas conectables, listarlas directas es más rápido que buscar; con muchas, una pared
  // de botones no se puede recorrer (auditoría de interacción, 2026-09-29): hace falta escribir para
  // acotarlas por título, hasta un máximo de resultados visibles a la vez.
  const [connectSearch, setConnectSearch] = useState('');
  const needsConnectSearch = targets.length > 6;
  const connectQuery = connectSearch.trim().toLowerCase();
  const matchingTargets = needsConnectSearch
    ? (connectQuery === '' ? [] : targets.filter((target) => cardTitle(target).toLowerCase().includes(connectQuery)))
    : targets;
  const visibleTargets = needsConnectSearch ? matchingTargets.slice(0, 8) : targets;
  // Tipo, rótulo y flecha (ADR 0034): una conexión a la vez en edición; la flecha se aplica al instante.
  const [editingRelation, setEditingRelation] = useState<{ readonly id: RelationId; readonly typeLabel: string; readonly label: string } | null>(null);
  const [connectTypeDraft, setConnectTypeDraft] = useState('');
  const arrowOptions: readonly { readonly value: RelationArrow; readonly label: string }[] = [
    { value: 'none', label: t('inspector.relation.arrow.none', locale) },
    { value: 'forward', label: t('inspector.relation.arrow.forward', locale) },
    { value: 'both', label: t('inspector.relation.arrow.both', locale) },
  ];
  const saveRelationEdit = () => {
    if (!editingRelation) return;
    const { id: relationId, typeLabel, label } = editingRelation;
    void run((storage, id) => updateConnection(storage, id, relationId, {
      ...(typeLabel.trim() === '' ? {} : { typeLabel: typeLabel.trim() }),
      ...(label.trim() === '' ? {} : { label: label.trim() }),
    }), 'action.connectionUpdated').then((result) => { if (result.ok) setEditingRelation(null); });
  };
  const rect = placement?.rect;

  return (
    <View testID="card-inspector" style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {inSheet ? null : (
        <View style={styles.header}>
          {/* El título ocupa su propia fila (auditoría visual, 2026-09-29): junto a «Ampliar»/«Cerrar»
              en la misma fila, el panel lateral angosto le dejaba tan poco ancho que se cortaba a mitad
              de la primera palabra aunque tuviera dos líneas permitidas. */}
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.heading.eyebrow', locale)}</Text>
            <Text accessibilityRole="header" numberOfLines={2} style={[styles.heading, { color: colors.textPrimary }]}>{cardTitle(card)}</Text>
          </View>
          <View style={styles.headerActions}>
            {onToggleFocus ? (
              <ActionButton label={focused ? t('workview.back', locale) : t('inspector.expand', locale)} accessibilityLabel={focused ? t('workview.back', locale) : t('inspector.expand.accessibilityLabel', locale)} onPress={onToggleFocus} />
            ) : null}
            <ActionButton label={t('inspector.close', locale)} accessibilityLabel={t('inspector.close.accessibilityLabel', locale)} onPress={() => { void flushPendingText().then((saved) => { if (saved) onClose(); }); }} />
          </View>
        </View>
      )}

      <Text testID="card-created" style={[styles.hint, { color: colors.textSecondary }]}>
        {formatCreated(card.createdAt, new Date(card.createdAt ?? 0).getTimezoneOffset(), locale)}
      </Text>
      {onSelectMany ? (
        <View style={styles.row}>
          <ActionButton label={t('inspector.selectMany', locale)} accessibilityLabel={t('inspector.selectMany.accessibilityLabel', locale)} onPress={onSelectMany} />
        </View>
      ) : null}
      <View style={styles.section}>
        <TextField label={t('inspector.title.label', locale)} value={title} onChangeText={changeTitle} placeholder={t('trash.item.untitled', locale)} />
        {linkKey ? (
          <View testID="card-link" style={styles.tagSection}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.link.section', locale)}</Text>
            <TextField label={t('inspector.link.address.label', locale)} value={linkDraft} onChangeText={setLinkDraft} placeholder={t('link.url.placeholder', locale)} onSubmitEditing={saveLink} testID="link-input" />
            <View style={styles.row}>
              {linkDraft !== currentLink ? <ActionButton label={t('inspector.link.save', locale)} tone="primary" onPress={saveLink} /> : null}
              {currentLink !== '' ? <ActionButton label={t('inspector.link.open', locale)} accessibilityLabel={t('inspector.link.open.accessibilityLabel', locale, { url: currentLink })} onPress={open} /> : null}
            </View>
            {linkProblem ? <Text testID="link-open-problem" style={[styles.hint, { color: colors.danger }]}>{linkProblem}</Text> : null}
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.link.hint', locale)}</Text>
          </View>
        ) : null}
        <View testID="card-tags" style={styles.tagSection}>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.tags.section', locale)}</Text>
          {(card.tags ?? []).length > 0 ? (
            <View style={styles.row} accessibilityLabel={t('inspector.tags.accessibilityLabel', locale)}>
              {(card.tags ?? []).map((tag) => (
                <ActionButton key={tag} label={`#${tag}  ×`} accessibilityLabel={t('inspector.tag.remove.accessibilityLabel', locale, { tag })} onPress={() => removeTag(tag)} />
              ))}
            </View>
          ) : <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.tags.empty', locale)}</Text>}
          <View style={styles.tagAdd}>
            <View style={styles.tagInput}>
              <TextField label={t('inspector.tag.new.label', locale)} value={tagDraft} onChangeText={setTagDraft} placeholder="#idea" onSubmitEditing={addTag} testID="tag-input" />
            </View>
            <ActionButton label={t('inspector.tag.add', locale)} accessibilityLabel={t('inspector.tag.add.accessibilityLabel', locale)} onPress={addTag} />
          </View>
        </View>
        <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel={t('inspector.lists.accessibilityLabel', locale)}>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.lists.section', locale)}</Text>
          <ActionButton label="−" accessibilityLabel={t('inspector.list.dash.accessibilityLabel', locale)} onPress={() => insertList('dash')} style={styles.listButton} />
          <ActionButton label="•" accessibilityLabel={t('inspector.list.bullet.accessibilityLabel', locale)} onPress={() => insertList('bullet')} style={styles.listButton} />
          <ActionButton label="1." accessibilityLabel={t('inspector.list.number.accessibilityLabel', locale)} onPress={() => insertList('number')} style={styles.listButton} />
          <ActionButton label="☐" accessibilityLabel={t('inspector.list.check.accessibilityLabel', locale)} onPress={() => insertList('check')} style={styles.listButton} />
        </View>
        <TextField label={t('inspector.content.label', locale)} value={content} onChangeText={changeContent} multiline placeholder={t('inspector.content.placeholder', locale)}
          fontFamily={noteFontFamily}
          selection={forcedSelection}
          onSelectionChange={(selection) => {
            selectionRef.current = selection;
            if (forcedSelection && selection.start === forcedSelection.start && selection.end === forcedSelection.end) setForcedSelection(undefined);
          }} />
        {withBlocks ? (
          <NoteBlocksEditor content={content} onChange={changeBlocks} images={noteImages} canPickImages={supportsImageImport()}
            onInsert={() => void placeImage({ kind: 'insert', caret: selectionRef.current.start })}
            onReplace={(index) => void placeImage({ kind: 'replace', index })} />
        ) : null}
        {imageProblem ? <Text testID="note-image-problem" accessibilityLiveRegion="assertive" style={[styles.hint, { color: colors.danger }]}>{imageProblem}</Text> : null}
        {content.split('\n').some((line) => /^\s*[-*+]\s+\[[ xX]\]/.test(line)) ? (
          <View testID="checklist-preview" style={styles.preview}>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.checklist.section', locale)}</Text>
            {content.split('\n').map((line, index) => {
              const check = /^(\s*[-*+]\s+)\[([ xX])\]\s*(.*)$/.exec(line);
              if (!check) return <Text key={index} style={[styles.body, { color: colors.textPrimary }]}>{line || ' '}</Text>;
              const checked = check[2]?.toLowerCase() === 'x';
              return <View key={index} style={styles.checkRow}>
                <ActionButton label={checked ? '☑' : '☐'} accessibilityLabel={t(checked ? 'inspector.checklist.uncheck.accessibilityLabel' : 'inspector.checklist.check.accessibilityLabel', locale, { text: check[3] ?? '' })}
                  pressed={checked} onPress={() => toggleCheck(index)} />
                <Text style={[styles.body, styles.checkText, { color: colors.textPrimary }]}>{check[3]}</Text>
              </View>;
            })}
          </View>
        ) : null}
        <View style={styles.row}>
          <ActionButton
            label={t('inspector.save', locale)}
            tone="primary"
            onPress={() => { void (mode === 'folder' ? flushPendingText() : run((storage, id) => editCardContent(storage, id, card.id, { title, content }), 'action.textSaved', { mergeKey: `text:${card.id}` })); }}
          />
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{dirty ? t('inspector.unsaved', locale) : t('inspector.saved', locale)}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.position.section', locale)}</Text>
        <Text testID="card-geometry" style={[styles.body, { color: colors.textPrimary }]}>
          {rect ? rect.x < 0 || rect.y < 0
            ? t('inspector.geometry.negative', locale, { x: String(rect.x), y: String(rect.y), w: String(rect.w), h: String(rect.h) })
            : t('inspector.geometry.cell', locale, { col: String(rect.x + 1), row: String(rect.y + 1), w: String(rect.w), h: String(rect.h) })
            : t('inspector.geometry.none', locale)}
        </Text>
        {rect ? (
          <>
            <View style={styles.row}>
              {moveKeys.map((move) => (
                <ActionButton
                  key={move.nameKey}
                  label={move.label}
                  accessibilityLabel={t(move.nameKey, locale)}
                  onPress={() => void run((storage, id) => moveCardOnBoard(storage, id, {
                    boardId, cardId: card.id, to: { x: rect.x + move.dx, y: rect.y + move.dy },
                  }), 'action.cardMoved')}
                />
              ))}
            </View>
            <View style={styles.row}>
              {resizeKeys.map((resize) => (
                <ActionButton
                  key={resize.nameKey}
                  label={t(resize.labelKey, locale)}
                  accessibilityLabel={t(resize.nameKey, locale)}
                  onPress={() => void run((storage, id) => resizeCardOnBoard(storage, id, {
                    boardId, cardId: card.id, size: { w: rect.w + resize.dw, h: rect.h + resize.dh },
                  }), 'action.sizeChanged')}
                />
              ))}
            </View>
          </>
        ) : null}
      </View>

      {placement ? (
        <View testID="card-display" style={styles.section}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.display.section', locale)}</Text>
          <View style={styles.row}>
            {displayKeys.map((option) => (
              <ActionButton
                key={option.display}
                label={t(option.labelKey, locale)}
                accessibilityLabel={t('inspector.display.show.accessibilityLabel', locale, { label: t(option.labelKey, locale).toLowerCase() })}
                pressed={placement.display === option.display}
                onPress={() => { if (placement.display !== option.display) onDisplay(option.display); }}
              />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.display.hint', locale)}</Text>
        </View>
      ) : null}

      <View testID="card-icon-picker" style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>ICONO</Text>
        <View style={styles.row}>
          {cardIconNames.map((icon) => (
            <ActionButton key={icon} label={icon === 'note' ? 'Nota' : icon === 'image' ? 'Imagen' : icon === 'folder' ? 'Carpeta' : icon === 'link' ? 'Enlace' : icon === 'check' ? 'Tarea' : 'Estrella'}
              accessibilityLabel={`Usar icono ${icon}`}
              pressed={card.icon === icon}
              onPress={() => void run((storage, id) => editCardAppearance(storage, id, card.id, { icon }), { label: 'Apariencia actualizada' })} />
          ))}
        </View>
        {card.boardTargetId ? (
          <ActionButton label="Abrir tablero" accessibilityLabel={`Abrir tablero ${workspace.boards.find((candidate) => candidate.id === card.boardTargetId)?.title ?? card.boardTargetId}`}
            tone="primary" onPress={() => onOpenBoard?.(card.boardTargetId as BoardId)} />
        ) : null}
      </View>

      {(card.assetRefs?.length ?? 0) > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.files.section', locale)}</Text>
          <Text testID="card-asset" style={[styles.body, { color: colors.textPrimary }]}>{card.assetRefs?.join(', ')}</Text>
        </View>
      ) : null}

      <View testID="card-connections" style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('inspector.connections.section', locale)}</Text>
        {connected.length === 0 ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>{t('inspector.connections.empty', locale)}</Text>
        ) : connected.map((relation) => {
          const outgoing = relation.from === card.id;
          const other = titles.get(outgoing ? relation.to : relation.from) ?? t('trash.item.untitled', locale);
          const typeLabel = typeLabels.get(relation.typeId) ?? '';
          const arrow = relation.arrow ?? 'forward';
          const editingThis = editingRelation?.id === relation.id;
          return (
            <View key={relation.id} testID={`connection-${relation.id}`} style={styles.connectionBlock}>
              <View style={styles.connection}>
                <Text style={[styles.body, styles.connectionText, { color: colors.textPrimary }]}>
                  {`${outgoing ? '→' : '←'} ${other} (${typeLabel}${relation.label ? `: ${relation.label}` : ''})`}
                </Text>
              </View>
              {editingThis ? (
                <>
                  <TextField label={t('inspector.relation.type.label', locale)} value={editingRelation.typeLabel} onChangeText={(value) => setEditingRelation({ ...editingRelation, typeLabel: value })} />
                  <TextField label={t('inspector.relation.label.label', locale)} value={editingRelation.label} onChangeText={(value) => setEditingRelation({ ...editingRelation, label: value })} placeholder={t('inspector.relation.label.placeholder', locale)} />
                  <View style={styles.row}>
                    <ActionButton label={t('inspector.relation.save', locale)} tone="primary" accessibilityLabel={t('inspector.relation.save.accessibilityLabel', locale)} onPress={saveRelationEdit} />
                    <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('inspector.relation.cancel.accessibilityLabel', locale)} onPress={() => setEditingRelation(null)} />
                  </View>
                </>
              ) : (
                <View style={styles.row}>
                  {arrowOptions.map((option) => (
                    <ActionButton
                      key={option.value}
                      label={option.label}
                      accessibilityLabel={t('inspector.relation.arrow.use.accessibilityLabel', locale, { label: option.label.toLowerCase() })}
                      pressed={arrow === option.value}
                      onPress={() => void run((storage, id) => updateConnection(storage, id, relation.id, { arrow: option.value }), 'action.connectionStyleChanged')}
                    />
                  ))}
                  <ActionButton
                    label={t('inspector.relation.edit', locale)}
                    accessibilityLabel={t('inspector.relation.edit.accessibilityLabel', locale, { other })}
                    onPress={() => setEditingRelation({ id: relation.id, typeLabel, label: relation.label ?? '' })}
                  />
                  <ActionButton
                    label={t('inspector.relation.disconnect', locale)}
                    accessibilityLabel={t(outgoing ? 'inspector.relation.disconnect.from.accessibilityLabel' : 'inspector.relation.disconnect.since.accessibilityLabel', locale, { other })}
                    onPress={() => void run((storage, id) => disconnectCards(storage, id, relation.id), 'action.connectionRemoved')}
                  />
                </View>
              )}
            </View>
          );
        })}
        {targets.length > 0 ? (
          <>
            <TextField label={t('inspector.connect.type.label', locale)} value={connectTypeDraft} onChangeText={setConnectTypeDraft} placeholder={t('inspector.connect.type.placeholder', locale)} testID="connect-type-input" />
            {needsConnectSearch ? (
              <TextField label={t('inspector.connect.search.label', locale)} value={connectSearch} onChangeText={setConnectSearch} placeholder={t('inspector.connect.search.placeholder', locale)} testID="connect-search-input" />
            ) : null}
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.connect.with', locale)}</Text>
          </>
        ) : null}
        {needsConnectSearch && connectQuery !== '' && matchingTargets.length === 0 ? (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.connect.none', locale, { query: connectSearch.trim() })}</Text>
        ) : null}
        <View style={styles.row}>
          {visibleTargets.map((target) => (
            <ActionButton
              key={target.id}
              label={cardTitle(target)}
              accessibilityLabel={t('inspector.connect.accessibilityLabel', locale, { title: cardTitle(target) })}
              onPress={() => void run((storage, id) => connectCards(storage, id, {
                from: card.id, to: target.id, ...(connectTypeDraft.trim() === '' ? {} : { typeLabel: connectTypeDraft.trim() }),
              }), 'action.cardsConnected')}
            />
          ))}
        </View>
        {needsConnectSearch && matchingTargets.length > visibleTargets.length ? (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {matchingTargets.length - visibleTargets.length === 1
              ? t('inspector.connect.more.one', locale)
              : t('inspector.connect.more.many', locale).replace('#', String(matchingTargets.length - visibleTargets.length))}
          </Text>
        ) : null}
      </View>
      <View style={styles.section}>
        <ActionButton label={t('inspector.archive', locale)} accessibilityLabel={t('inspector.archive.accessibilityLabel', locale, { title: cardTitle(card) })} onPress={onArchive} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.archive.hint', locale)}</Text>
        <ActionButton label={t('inspector.trash', locale)} accessibilityLabel={t('inspector.trash.accessibilityLabel', locale, { title: cardTitle(card) })} onPress={onTrash} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('inspector.trash.hint', locale)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tagSection: { gap: 6 },
  tagAdd: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  tagInput: { flex: 1, minWidth: 0 },
  // Botones de lista de 44 × 44: los cuatro caben en una fila junto a «LISTAS» (panel de 320 px).
  listButton: { width: 44, minWidth: 44, paddingHorizontal: 0 },
  panel: { padding: 16, gap: 20 },
  header: { gap: 10 },
  headerText: { minWidth: 0, gap: 4 },
  headerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: '800' },
  section: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  body: { fontSize: 15, lineHeight: 21 },
  hint: { fontSize: 13, lineHeight: 18 },
  connectionBlock: { gap: 6 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectionText: { flex: 1, minWidth: 0 },
  preview: { gap: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText: { flex: 1, minWidth: 0 },
});
