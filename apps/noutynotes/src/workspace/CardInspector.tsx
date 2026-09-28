import { addCardTag, addNoteImage, assetsOf, connectCards, disconnectCards, editCardContent, moveCardOnBoard, removeCardTag, resizeCardOnBoard, setCardLink } from '@noutynotes/application';
import type { WorkspaceStorageResult } from '@noutynotes/application';
import { linkUrlField } from '@noutynotes/domain';
import type { BoardId, Card, CardDisplayMode, CardId, CardPlacement, Workspace } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { formatCreated } from './dates';
import { describeFailure } from '../session/messages';
import { pickImageFile, supportsImageImport } from '../session/imageFiles';
import { useWorkspaceSession } from '../session/WorkspaceSession';
import { cardTitle } from './Board';
import { applyListCommand, normalizeListChange, toggleChecklistLine } from './markdownLists';
import { NoteBlocksEditor } from './NoteBlocksEditor';
import { openLink } from './openLink';
import type { ListKind, TextSelection } from './markdownLists';
import type { RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: string, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;

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
}

const displays: readonly { display: CardDisplayMode; label: string }[] = [
  { display: 'expanded', label: 'Expandida' },
  { display: 'collapsed', label: 'Contraída' },
  { display: 'minimized', label: 'Minimizada' },
];

const moves = [
  { label: '←', name: 'Mover a la izquierda', dx: -1, dy: 0 },
  { label: '→', name: 'Mover a la derecha', dx: 1, dy: 0 },
  { label: '↑', name: 'Mover arriba', dx: 0, dy: -1 },
  { label: '↓', name: 'Mover abajo', dx: 0, dy: 1 },
] as const;

const resizes = [
  { label: 'Ancho −', name: 'Más estrecha', dw: -1, dh: 0 },
  { label: 'Ancho +', name: 'Más ancha', dw: 1, dh: 0 },
  { label: 'Alto −', name: 'Más baja', dw: 0, dh: -1 },
  { label: 'Alto +', name: 'Más alta', dw: 0, dh: 1 },
] as const;

/**
 * Editor de la tarjeta seleccionada. Cada botón despacha un caso de uso; los límites y colisiones
 * los decide el motor de grilla y los errores se muestran tal como los devuelve.
 */
export function CardInspector({ workspace, boardId, card, placement, run, onDraftChange, flushPendingText, onClose, onDisplay, onTrash, onArchive, onSelectMany, inSheet = false, noteImages, noteFontFamily, focused = false, onToggleFocus }: CardInspectorProps) {
  const { mode } = useWorkspaceSession();
  const { theme } = useTheme();
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
    void run((storage, id) => addCardTag(storage, id, card.id, input), 'Etiqueta añadida. Guardado en memoria.')
      .then((result) => { if (result.ok) setTagDraft(''); });
  };
  const removeTag = (tag: string) => {
    void run((storage, id) => removeCardTag(storage, id, card.id, tag), `Etiqueta «#${tag}» quitada. Guardado en memoria.`);
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
    void run((storage, id) => setCardLink(storage, id, card.id, input), 'Enlace guardado. Guardado en memoria.')
      .then((result) => { if (result.ok) setLinkDraft(result.value); });
  };
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const open = () => {
    setLinkProblem(null);
    void openLink(currentLink).then((opened) => {
      if (!opened) setLinkProblem('No se pudo abrir el enlace con este dispositivo. La dirección sigue guardada.');
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
    if (!supportsImageImport()) return setImageProblem('Este entorno no permite elegir imágenes.');
    let picked;
    try {
      picked = await pickImageFile();
    } catch {
      return setImageProblem('No se pudo leer la imagen elegida. Comprueba el permiso y vuelve a intentarlo.');
    }
    if (!picked) return undefined;
    const file = picked;
    const draft = content;
    const result = await run((storage, id) => {
      const assets = assetsOf(storage);
      if (!assets) return Promise.resolve({ ok: false as const, issues: [{ code: 'invalid-asset' as const, path: 'storage', message: 'Este almacenamiento no guarda imágenes.' }] });
      return addNoteImage(storage, assets, id, card.id, { bytes: file.bytes, fileName: file.name, content: draft, place });
    }, place.kind === 'insert' ? `Imagen «${file.name}» insertada en la nota. Guardado en memoria.` : `Imagen reemplazada por «${file.name}». Guardado en memoria.`);
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
  const connected = workspace.relations.filter((relation) => relation.from === card.id || relation.to === card.id);
  const targets = workspace.cards.filter((other) => other.id !== card.id
    && !workspace.relations.some((relation) => relation.from === card.id && relation.to === other.id));
  const rect = placement?.rect;

  return (
    <View testID="card-inspector" style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {inSheet ? null : (
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>TARJETA SELECCIONADA</Text>
            <Text accessibilityRole="header" numberOfLines={2} style={[styles.heading, { color: colors.textPrimary }]}>{cardTitle(card)}</Text>
          </View>
          {onToggleFocus ? (
            <ActionButton label={focused ? 'Volver al tablero' : 'Ampliar'} accessibilityLabel={focused ? 'Volver al tablero' : 'Ampliar el editor'} onPress={onToggleFocus} />
          ) : null}
          <ActionButton label="Cerrar" accessibilityLabel="Cerrar el editor de la tarjeta" onPress={() => { void flushPendingText().then((saved) => { if (saved) onClose(); }); }} />
        </View>
      )}

      <Text testID="card-created" style={[styles.hint, { color: colors.textSecondary }]}>
        {formatCreated(card.createdAt, new Date(card.createdAt ?? 0).getTimezoneOffset())}
      </Text>
      {onSelectMany ? (
        <View style={styles.row}>
          <ActionButton label="Seleccionar varias" accessibilityLabel="Seleccionar varias tarjetas empezando por esta" onPress={onSelectMany} />
        </View>
      ) : null}
      <View style={styles.section}>
        <TextField label="Título de la tarjeta" value={title} onChangeText={changeTitle} placeholder="Sin título" />
        {linkKey ? (
          <View testID="card-link" style={styles.tagSection}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>ENLACE</Text>
            <TextField label="Dirección del enlace" value={linkDraft} onChangeText={setLinkDraft} placeholder="https://ejemplo.com" onSubmitEditing={saveLink} testID="link-input" />
            <View style={styles.row}>
              {linkDraft !== currentLink ? <ActionButton label="Guardar enlace" tone="primary" onPress={saveLink} /> : null}
              {currentLink !== '' ? <ActionButton label="Abrir enlace ↗" accessibilityLabel={`Abrir el enlace ${currentLink}`} onPress={open} /> : null}
            </View>
            {linkProblem ? <Text testID="link-open-problem" style={[styles.hint, { color: colors.danger }]}>{linkProblem}</Text> : null}
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Abrir necesita conexión. NoutyNotes no descarga nada de la página.</Text>
          </View>
        ) : null}
        <View testID="card-tags" style={styles.tagSection}>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>ETIQUETAS</Text>
          {(card.tags ?? []).length > 0 ? (
            <View style={styles.row} accessibilityLabel="Etiquetas de la tarjeta">
              {(card.tags ?? []).map((tag) => (
                <ActionButton key={tag} label={`#${tag}  ×`} accessibilityLabel={`Quitar la etiqueta ${tag}`} onPress={() => removeTag(tag)} />
              ))}
            </View>
          ) : <Text style={[styles.hint, { color: colors.textSecondary }]}>Sin etiquetas. El «#» escrito en el texto no crea etiquetas.</Text>}
          <View style={styles.tagAdd}>
            <View style={styles.tagInput}>
              <TextField label="Nueva etiqueta" value={tagDraft} onChangeText={setTagDraft} placeholder="#idea" onSubmitEditing={addTag} testID="tag-input" />
            </View>
            <ActionButton label="Añadir" accessibilityLabel="Añadir la etiqueta" onPress={addTag} />
          </View>
        </View>
        <View style={styles.row} accessibilityRole="toolbar" accessibilityLabel="Listas Markdown">
          <Text style={[styles.hint, { color: colors.textSecondary }]}>LISTAS</Text>
          <ActionButton label="−" accessibilityLabel="Insertar lista con guiones" onPress={() => insertList('dash')} style={styles.listButton} />
          <ActionButton label="•" accessibilityLabel="Insertar lista con viñetas" onPress={() => insertList('bullet')} style={styles.listButton} />
          <ActionButton label="1." accessibilityLabel="Insertar lista numerada" onPress={() => insertList('number')} style={styles.listButton} />
          <ActionButton label="☐" accessibilityLabel="Insertar lista de tareas" onPress={() => insertList('check')} style={styles.listButton} />
        </View>
        <TextField label="Contenido Markdown" value={content} onChangeText={changeContent} multiline placeholder="# Una idea"
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
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>VISTA DE TAREAS</Text>
            {content.split('\n').map((line, index) => {
              const check = /^(\s*[-*+]\s+)\[([ xX])\]\s*(.*)$/.exec(line);
              if (!check) return <Text key={index} style={[styles.body, { color: colors.textPrimary }]}>{line || ' '}</Text>;
              const checked = check[2]?.toLowerCase() === 'x';
              return <View key={index} style={styles.checkRow}>
                <ActionButton label={checked ? '☑' : '☐'} accessibilityLabel={`${checked ? 'Desmarcar' : 'Marcar'} tarea ${check[3] ?? ''}`}
                  pressed={checked} onPress={() => toggleCheck(index)} />
                <Text style={[styles.body, styles.checkText, { color: colors.textPrimary }]}>{check[3]}</Text>
              </View>;
            })}
          </View>
        ) : null}
        <View style={styles.row}>
          <ActionButton
            label="Guardar texto"
            tone="primary"
            onPress={() => { void (mode === 'folder' ? flushPendingText() : run((storage, id) => editCardContent(storage, id, card.id, { title, content }), 'Texto guardado en memoria.', { mergeKey: `text:${card.id}` })); }}
          />
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{dirty ? 'Cambios sin guardar' : 'Sin cambios pendientes'}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>POSICIÓN EN EL LIENZO</Text>
        <Text testID="card-geometry" style={[styles.body, { color: colors.textPrimary }]}>
          {rect ? rect.x < 0 || rect.y < 0
            ? `X ${rect.x}, Y ${rect.y} · ${rect.w} × ${rect.h}`
            : `Columna ${rect.x + 1}, fila ${rect.y + 1} · ${rect.w} × ${rect.h}` : 'Sin colocación en este tablero'}
        </Text>
        {rect ? (
          <>
            <View style={styles.row}>
              {moves.map((move) => (
                <ActionButton
                  key={move.name}
                  label={move.label}
                  accessibilityLabel={move.name}
                  onPress={() => void run((storage, id) => moveCardOnBoard(storage, id, {
                    boardId, cardId: card.id, to: { x: rect.x + move.dx, y: rect.y + move.dy },
                  }), 'Tarjeta movida. Guardado en memoria.')}
                />
              ))}
            </View>
            <View style={styles.row}>
              {resizes.map((resize) => (
                <ActionButton
                  key={resize.name}
                  label={resize.label}
                  accessibilityLabel={resize.name}
                  onPress={() => void run((storage, id) => resizeCardOnBoard(storage, id, {
                    boardId, cardId: card.id, size: { w: rect.w + resize.dw, h: rect.h + resize.dh },
                  }), 'Tamaño cambiado. Guardado en memoria.')}
                />
              ))}
            </View>
          </>
        ) : null}
      </View>

      {placement ? (
        <View testID="card-display" style={styles.section}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>REPRESENTACIÓN</Text>
          <View style={styles.row}>
            {displays.map((option) => (
              <ActionButton
                key={option.display}
                label={option.label}
                accessibilityLabel={`Mostrar ${option.label.toLowerCase()}`}
                pressed={placement.display === option.display}
                onPress={() => { if (placement.display !== option.display) onDisplay(option.display); }}
              />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Conserva el contenido, el tamaño expandido y las conexiones.</Text>
        </View>
      ) : null}

      {(card.assetRefs?.length ?? 0) > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>ARCHIVO</Text>
          <Text testID="card-asset" style={[styles.body, { color: colors.textPrimary }]}>{card.assetRefs?.join(', ')}</Text>
        </View>
      ) : null}

      <View testID="card-connections" style={styles.section}>
        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>CONEXIONES</Text>
        {connected.length === 0 ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>Sin conexiones.</Text>
        ) : connected.map((relation) => {
          const outgoing = relation.from === card.id;
          const other = titles.get(outgoing ? relation.to : relation.from) ?? 'Sin título';
          return (
            <View key={relation.id} style={styles.connection}>
              <Text style={[styles.body, styles.connectionText, { color: colors.textPrimary }]}>
                {outgoing ? `→ ${other}` : `← ${other}`}
              </Text>
              <ActionButton
                label="Desconectar"
                accessibilityLabel={outgoing ? `Desconectar de ${other}` : `Desconectar desde ${other}`}
                onPress={() => void run((storage, id) => disconnectCards(storage, id, relation.id), 'Conexión eliminada. Guardado en memoria.')}
              />
            </View>
          );
        })}
        {targets.length > 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Conectar con:</Text> : null}
        <View style={styles.row}>
          {targets.map((target) => (
            <ActionButton
              key={target.id}
              label={cardTitle(target)}
              accessibilityLabel={`Conectar con ${cardTitle(target)}`}
              onPress={() => void run((storage, id) => connectCards(storage, id, { from: card.id, to: target.id }), 'Tarjetas conectadas. Guardado en memoria.')}
            />
          ))}
        </View>
      </View>
      <View style={styles.section}>
        <ActionButton label="Archivar" accessibilityLabel={`Archivar la tarjeta ${cardTitle(card)}`} onPress={onArchive} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Archivar la aparta de los tableros y de las búsquedas sin eliminarla; se restaura desde el Archivo.</Text>
        <ActionButton label="Enviar a la Papelera" accessibilityLabel={`Enviar la tarjeta ${cardTitle(card)} a la Papelera`} onPress={onTrash} />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>No se borra: podrás restaurarla desde la Papelera.</Text>
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
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headerText: { flex: 1, minWidth: 0, gap: 4 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: '800' },
  section: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  body: { fontSize: 15, lineHeight: 21 },
  hint: { fontSize: 13, lineHeight: 18 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectionText: { flex: 1, minWidth: 0 },
  preview: { gap: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText: { flex: 1, minWidth: 0 },
});
