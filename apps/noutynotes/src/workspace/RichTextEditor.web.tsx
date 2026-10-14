import { $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  $isListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { $createHeadingNode, $isHeadingNode, HeadingNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $insertTableColumnAtNode,
  $insertTableRowAtNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $setTableRowIsHeader,
  INSERT_TABLE_COMMAND,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  KEY_DOWN_COMMAND,
  PASTE_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  mergeRegister,
} from 'lexical';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { EditorState } from 'lexical';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { isLinkUrl } from '@noutynotes/domain';
import type { RichTextAlignment } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';

import { t } from '../i18n';
import { $createWebRichTextNodes, $loadWebRichTextDocument, $readWebRichTextDocument } from './richTextLexical';
import { parsePastedRichText } from './richTextPaste.web';
import { $createRichTextImageNode, $isRichTextImageNode, RichTextImageNode, RichTextImageProvider } from './RichTextImageNode.web';
import type { RichTextEditorProps } from './RichTextEditor.types';

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type BlockKind = 'paragraph' | `heading-${HeadingLevel}` | 'bullet' | 'ordered' | 'checklist';
const MAX_TABLE_ROWS = 20;
const MAX_TABLE_COLUMNS = 12;

type TableMenuAction = {
  readonly label: string;
  readonly action: () => void;
  readonly disabled?: boolean;
  readonly key: string;
  readonly group: 'rows' | 'columns' | 'structure' | 'alignment';
};

const tableMenuGroupLabels: Readonly<Record<TableMenuAction['group'], string>> = {
  rows: 'Filas', columns: 'Columnas', structure: 'Estructura', alignment: 'Alineación vertical',
};

function TableContextMenu({ anchor, actions, colors, onClose }: {
  readonly anchor: HTMLElement;
  readonly actions: readonly TableMenuAction[];
  readonly colors: { readonly border: string; readonly surface: string; readonly textPrimary: string; readonly gridLine: string };
  readonly onClose: (restoreFocus: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; width: number; maxHeight: number; top?: number; bottom?: number }>(() => ({ left: 8, top: 8, width: 320, maxHeight: 320 }));

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(360, Math.max(280, window.innerWidth - 16));
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = Math.max(0, window.innerHeight - rect.bottom - 8);
      const above = Math.max(0, rect.top - 8);
      if (below < 260 && above > below) setPosition({ left, bottom: window.innerHeight - rect.top + 6, width, maxHeight: Math.max(120, above - 6) });
      else setPosition({ left, top: rect.bottom + 6, width, maxHeight: Math.max(120, below - 6) });
    };
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose(true);
    };
    place();
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, onClose]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1 + items.length) % items.length
        : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };
  const groups = (['rows', 'columns', 'structure', 'alignment'] as const).map((group) => ({ group, actions: actions.filter((item) => item.group === group) }));

  return (
    <Modal transparent visible animationType="none" onRequestClose={() => onClose(true)}>
    <div
      ref={menuRef}
      data-testid="editor-table-menu"
      role="menu"
      aria-label="Opciones de tabla"
      onKeyDown={moveFocus}
      style={{
        position: 'fixed', zIndex: 1000, left: position.left, top: position.top, bottom: position.bottom,
        width: position.width, maxWidth: 'calc(100vw - 16px)', maxHeight: position.maxHeight, overflowY: 'auto',
        boxSizing: 'border-box', border: `2px solid ${colors.border}`, background: colors.surface,
        color: colors.textPrimary, padding: 8, boxShadow: '0 10px 28px rgba(0,0,0,.28)',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: position.width >= 340 ? 'repeat(2,minmax(0,1fr))' : '1fr', gap: 8 }}>
        {groups.map(({ group, actions: groupActions }) => (
          <div key={group} role="group" aria-label={tableMenuGroupLabels[group]} style={{ minWidth: 0 }}>
            <div style={{ padding: '4px 8px', borderBottom: `1px solid ${colors.gridLine}`, fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{tableMenuGroupLabels[group]}</div>
            {groupActions.map((item) => (
              <button
                key={item.key}
                data-testid={`editor-table-menu-${item.key}`}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => { item.action(); onClose(true); }}
                style={{
                  display: 'block', width: '100%', minHeight: 40, padding: '8px', border: 0,
                  background: 'transparent', color: 'inherit', textAlign: 'left', fontSize: 12,
                  fontWeight: 700, opacity: item.disabled ? 0.4 : 1, cursor: item.disabled ? 'default' : 'pointer',
                }}
              >{item.label}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
    </Modal>
  );
}

function EditorToolbar({ onInsertImage, titleOnly = false, compact = false, collapsed = false }: Pick<RichTextEditorProps, 'onInsertImage' | 'titleOnly'> & { readonly compact?: boolean; readonly collapsed?: boolean }) {
  const [editor] = useLexicalComposerContext();
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [alignment, setAlignment] = useState<RichTextAlignment>('left');
  const [block, setBlock] = useState<BlockKind>('paragraph');
  const [inTable, setInTable] = useState(false);
  // UX7-CONSOLIDATION (Hito B): la celda activa se recuerda por clave de nodo, no por selección en
  // vivo — pulsar el botón «Opciones de tabla» saca momentáneamente el foco del contenido (mismo
  // tránsito que ya hacía inestable la selección en vivo para `inTable` más abajo), y las acciones de
  // la tabla deben seguir apuntando a la celda donde estaba el cursor, no a una selección nula.
  const [tableCellKey, setTableCellKey] = useState<string | null>(null);
  const [tableRowCount, setTableRowCount] = useState(0);
  const [tableColumnCount, setTableColumnCount] = useState(0);
  const [tableVerticalAlignment, setTableVerticalAlignment] = useState<'top' | 'center' | 'bottom'>('top');
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [tableMenuAnchor, setTableMenuAnchor] = useState<HTMLDivElement | null>(null);
  const [selectionLink, setSelectionLink] = useState('');
  const [linkHref, setLinkHref] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkProblem, setLinkProblem] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [tableRows, setTableRows] = useState('3');
  const [tableColumns, setTableColumns] = useState('3');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // UX7-VISUAL-FINALIZATION: la edición rápida conserva una sola fila estable. El bloque, negrita y
  // cursiva quedan directos; listas, enlace, imagen, tabla e historial permanecen en «Más formato».
  // El Inspector completo (`compact=false`) conserva todas sus acciones visibles.
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!collapsed) return;
    const frame = requestAnimationFrame(() => {
      setMoreOpen(false);
      setLinkOpen(false);
      setTableOpen(false);
      setTableMenuOpen(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsed]);

  const readSelection = useCallback(() => {
    const selection = $getSelection();
    setBold($isRangeSelection(selection) && selection.hasFormat('bold'));
    setItalic($isRangeSelection(selection) && selection.hasFormat('italic'));
    // Al pulsar un control de la barra el foco sale momentáneamente del contenido y Lexical publica
    // una selección nula antes del `onPress`. Se conserva la última tabla en ese tránsito; una nueva
    // selección de rango fuera de la tabla sí limpia el contexto unas líneas más abajo.
    if (!$isRangeSelection(selection)) return false;
    let selectionNode = selection.anchor.getNode();
    let insideTable = false;
    let selectedTable: TableNode | null = null;
    let selectedCell: TableCellNode | null = null;
    while (selectionNode.getParent() !== null) {
      if ($isTableCellNode(selectionNode)) { insideTable = true; selectedCell = selectionNode; }
      if ($isTableNode(selectionNode)) selectedTable = selectionNode;
      selectionNode = selectionNode.getParent() ?? selectionNode;
    }
    setInTable(insideTable);
    if (!insideTable) setTableMenuOpen(false);
    setTableCellKey(selectedCell ? selectedCell.getKey() : null);
    const selectedVertical = selectedCell?.getVerticalAlign();
    setTableVerticalAlignment(selectedVertical === 'middle' ? 'center' : selectedVertical === 'bottom' ? 'bottom' : 'top');
    setTableRowCount(selectedTable ? selectedTable.getChildrenSize() : 0);
    const firstRow = selectedTable?.getFirstChild();
    setTableColumnCount($isTableRowNode(firstRow) ? firstRow.getChildrenSize() : 0);
    const top = selectedTable ?? selection.anchor.getNode().getTopLevelElement();
    // Los controles de una imagen decorada pueden dejar el ancla temporalmente en la raíz.
    if (!top) return false;
    const format = top.getFormatType();
    setAlignment(format === 'center' || format === 'right' || format === 'justify' ? format : 'left');
    if ($isHeadingNode(top)) setBlock(`heading-${Number(top.getTag().slice(1)) as HeadingLevel}`);
    else if ($isListNode(top)) setBlock(top.getListType() === 'number' ? 'ordered' : top.getListType() === 'check' ? 'checklist' : 'bullet');
    else setBlock('paragraph');
    let current = selection.anchor.getNode();
    let href = '';
    while (current.getParent() !== null) {
      if ($isLinkNode(current)) href = current.getURL();
      current = current.getParent() ?? current;
    }
    setSelectionLink(href);
    return false;
  }, []);

  useEffect(() => mergeRegister(
    editor.registerCommand(SELECTION_CHANGE_COMMAND, readSelection, COMMAND_PRIORITY_LOW),
    editor.registerCommand(CAN_UNDO_COMMAND, (value) => { setCanUndo(value); return false; }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(CAN_REDO_COMMAND, (value) => { setCanRedo(value); return false; }, COMMAND_PRIORITY_LOW),
  ), [editor, readSelection]);
  const chooseBlock = useCallback((next: BlockKind) => {
    if (inTable) return;
    if (next === 'bullet' || next === 'ordered' || next === 'checklist') {
      const command = next === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : next === 'ordered' ? INSERT_ORDERED_LIST_COMMAND : INSERT_CHECK_LIST_COMMAND;
      editor.dispatchCommand(block === next ? REMOVE_LIST_COMMAND : command, undefined);
      return;
    }
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () => next === 'paragraph'
        ? $createParagraphNode()
        : $createHeadingNode(`h${next.slice(-1)}` as `h${HeadingLevel}`));
    });
  }, [block, editor, inTable]);

  const openLink = useCallback(() => {
    setLinkHref(selectionLink);
    setLinkProblem(false);
    setLinkOpen(true);
  }, [selectionLink]);

  useEffect(() => editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
    if (titleOnly && event.key === 'Enter') { event.preventDefault(); return true; }
    if (!(event.ctrlKey || event.metaKey)) return false;
    const key = event.key.toLowerCase();
    if (key === 'k') { event.preventDefault(); openLink(); return true; }
    if (event.altKey && /^[0-6]$/.test(key)) {
      event.preventDefault();
      chooseBlock(key === '0' ? 'paragraph' : `heading-${Number(key) as HeadingLevel}`);
      return true;
    }
    if (event.shiftKey && ['7', '8', '9'].includes(key)) {
      event.preventDefault();
      chooseBlock(key === '7' ? 'ordered' : key === '8' ? 'bullet' : 'checklist');
      return true;
    }
    return false;
  }, COMMAND_PRIORITY_LOW), [chooseBlock, editor, openLink, titleOnly]);

  const applyLink = () => {
    const href = linkHref.trim();
    if (!isLinkUrl(href)) { setLinkProblem(true); return; }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, href);
    setSelectionLink(href);
    setLinkOpen(false);
  };
  const removeLink = () => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    setSelectionLink('');
    setLinkHref('');
    setLinkProblem(false);
    setLinkOpen(false);
  };
  const rows = Number(tableRows);
  const columns = Number(tableColumns);
  const validTableSize = Number.isInteger(rows) && rows >= 2 && rows <= MAX_TABLE_ROWS
    && Number.isInteger(columns) && columns >= 1 && columns <= MAX_TABLE_COLUMNS;
  const insertTable = () => {
    if (!validTableSize) return;
    editor.dispatchCommand(INSERT_TABLE_COMMAND, {
      rows: String(rows), columns: String(columns), includeHeaders: { rows: true, columns: false },
    });
    setTableOpen(false);
  };
  // UX7-CONSOLIDATION (Hito B): las acciones de tabla ya no reescriben todo el documento por índice
  // de bloque (eso perdía la celda/columna real donde estaba el cursor y siempre operaba al final de
  // la tabla). Ahora usan las utilidades nativas de `@lexical/table` sobre la celda recordada
  // (`tableCellKey`), que sí saben insertar/eliminar la fila o columna exacta de la selección y
  // conservan el resto del árbol Lexical intacto (deshacer/rehacer y manejo de foco de Lexical siguen
  // aplicando sin cambios).
  const withSelectedCell = (action: (cellNode: TableCellNode) => void) => {
    if (!tableCellKey) return;
    editor.update(() => {
      const cellNode = $getNodeByKey(tableCellKey);
      if (!cellNode || !$isTableCellNode(cellNode)) return;
      action(cellNode);
    });
  };
  const insertTableRow = (insertAfter: boolean) => withSelectedCell((cellNode) => { $insertTableRowAtNode(cellNode, insertAfter); });
  const insertTableColumn = (insertAfter: boolean) => {
    if (tableColumnCount >= MAX_TABLE_COLUMNS) return;
    withSelectedCell((cellNode) => { $insertTableColumnAtNode(cellNode, insertAfter); });
  };
  const deleteTableRow = () => {
    if (tableRowCount <= 1) return;
    withSelectedCell((cellNode) => { cellNode.selectStart(); $deleteTableRowAtSelection(); });
  };
  const deleteTableColumn = () => {
    if (tableColumnCount <= 1) return;
    withSelectedCell((cellNode) => { cellNode.selectStart(); $deleteTableColumnAtSelection(); });
  };
  const toggleTableHeader = () => withSelectedCell((cellNode) => {
    const rowNode = cellNode.getParent();
    const tableNode = rowNode?.getParent();
    if (!$isTableNode(tableNode)) return;
    const firstRow = tableNode.getFirstChild();
    const firstCell = $isTableRowNode(firstRow) ? firstRow.getFirstChild() : null;
    const isHeader = $isTableCellNode(firstCell) ? firstCell.hasHeader() : false;
    $setTableRowIsHeader(tableNode, 0, !isHeader);
  });
  const alignTableCell = (alignment: 'top' | 'center' | 'bottom') => withSelectedCell((cellNode) => {
    cellNode.setVerticalAlign(alignment === 'center' ? 'middle' : alignment === 'bottom' ? 'bottom' : null);
    setTableVerticalAlignment(alignment);
  });
  const tableMenuActions: readonly TableMenuAction[] = [
    { key: 'row-above', group: 'rows', label: t('editor.visual.table.addRowAbove', locale), action: () => insertTableRow(false) },
    { key: 'row-below', group: 'rows', label: t('editor.visual.table.addRowBelow', locale), action: () => insertTableRow(true) },
    { key: 'column-left', group: 'columns', label: t('editor.visual.table.addColumnLeft', locale), action: () => insertTableColumn(false), disabled: tableColumnCount >= MAX_TABLE_COLUMNS },
    { key: 'column-right', group: 'columns', label: t('editor.visual.table.addColumnRight', locale), action: () => insertTableColumn(true), disabled: tableColumnCount >= MAX_TABLE_COLUMNS },
    { key: 'remove-row', group: 'structure', label: t('editor.visual.table.removeRow', locale), action: deleteTableRow, disabled: tableRowCount <= 1 },
    { key: 'remove-column', group: 'structure', label: t('editor.visual.table.removeColumn', locale), action: deleteTableColumn, disabled: tableColumnCount <= 1 },
    { key: 'toggle-header', group: 'structure', label: t('editor.visual.table.toggleHeader', locale), action: toggleTableHeader },
    { key: 'align-top', group: 'alignment', label: `${tableVerticalAlignment === 'top' ? '✓ ' : ''}Alinear celda arriba`, action: () => alignTableCell('top') },
    { key: 'align-center', group: 'alignment', label: `${tableVerticalAlignment === 'center' ? '✓ ' : ''}Centrar celda verticalmente`, action: () => alignTableCell('center') },
    { key: 'align-bottom', group: 'alignment', label: `${tableVerticalAlignment === 'bottom' ? '✓ ' : ''}Alinear celda abajo`, action: () => alignTableCell('bottom') },
  ];
  const insertImage = async () => {
    if (!onInsertImage) return;
    const snapshot = editor.getEditorState().read(() => {
      const selection = $getSelection();
      const document = $readWebRichTextDocument();
      if (!document) return null;
      if (!$isRangeSelection(selection)) return { document, afterBlock: $getRoot().getChildrenSize() - 1 };
      const top = selection.anchor.getNode().getTopLevelElement();
      const children = $getRoot().getChildren();
      let afterBlock = top ? children.indexOf(top) : children.length - 1;
      // Repetir «Insertar imagen» desde el mismo párrafo construye una galería en el orden elegido,
      // en vez de anteponer cada archivo nuevo al anterior.
      while ($isRichTextImageNode(children[afterBlock + 1])) afterBlock += 1;
      return { document, afterBlock };
    });
    if (!snapshot) return;
    const { document, afterBlock } = snapshot;
    const image = await onInsertImage(document, afterBlock);
    if (!image) return;
    editor.update(() => {
      const root = $getRoot();
      const node = $createRichTextImageNode(image);
      const target = root.getChildren()[afterBlock];
      if (target) target.insertAfter(node);
      else root.append(node);
    });
  };

  const button = (label: string, accessibilityLabel: string, selected: boolean, disabled: boolean, action: () => void, key?: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={action}
      style={({ pressed }) => [styles.toolButton, {
        borderColor: selected ? colors.selection : colors.border,
        backgroundColor: selected ? colors.accent : colors.surface,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      }]}
    >
      <Text style={[styles.toolText, { color: colors.textPrimary }, label === 'B' ? styles.bold : null, label === 'I' ? styles.italic : null]}>{label}</Text>
    </Pressable>
  );

  // `compactFormat` afecta únicamente a la representación de la toolbar: no cambia comandos,
  // documento, selección ni sesión editorial.
  const compactFormat = compact && !titleOnly;
  const linkImageTableControls = [
    button('↗', t('editor.visual.link', locale), selectionLink !== '', false, openLink, 'link'),
    !titleOnly && onInsertImage ? button('▧', 'Insertar una imagen', false, false, () => { void insertImage(); }, 'image') : null,
    titleOnly ? null : button('▦', t('editor.visual.table', locale), false, false, () => setTableOpen((open) => !open), 'table'),
  ];
  const alignmentControls = <View testID="editor-alignment-controls" accessibilityRole="toolbar" accessibilityLabel="Alineación horizontal" style={[styles.alignmentGroup, { borderColor: colors.gridLine }]}>{([
    ['left', 'Alinear a la izquierda'],
    ['center', 'Centrar'],
    ['right', 'Alinear a la derecha'],
    ['justify', 'Justificar'],
  ] as const).map(([value, accessibilityLabel]) => (
    <div key={`align-${value}`} title={accessibilityLabel} style={{ display: 'flex' }}>
    <Pressable
      testID={`editor-align-${value}`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inTable, selected: alignment === value }}
      disabled={inTable}
      onPress={() => {
        editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, value);
        editor.focus();
      }}
      style={({ pressed }) => [styles.toolButton, {
        borderColor: alignment === value ? colors.selection : colors.border,
        backgroundColor: alignment === value ? colors.accent : colors.surface,
        opacity: inTable ? 0.45 : pressed ? 0.7 : 1,
      }]}
    >
      <View style={[styles.alignmentIcon, value === 'left' ? styles.alignLeft : value === 'right' ? styles.alignRight : styles.alignCenter]}>
        {[24, value === 'justify' ? 24 : 17, 24, value === 'justify' ? 24 : 14].map((width, index) => (
          <View key={index} style={[styles.alignmentLine, { width, backgroundColor: colors.textPrimary }]} />
        ))}
      </View>
    </Pressable>
    </div>
  ))}</View>;
  // UX7-CONSOLIDATION (Hito B): un único control contextual «Opciones de tabla» sustituye la fila fija
  // de 5 iconos abreviados (D28) — esa fila ocupaba espacio permanente mientras el cursor seguía dentro
  // de la tabla, incluso sin usarla, y en la edición rápida (tarjeta pequeña) llegaba a tapar casi todo
  // el contenido (ver captura `hito-a-03-tras-reabrir.png`). El menú solo aparece con el cursor dentro
  // de una tabla, usa etiquetas legibles en vez de abreviaturas y se cierra tras cada acción o al salir
  // de la tabla.
  const tableMenuControl = !titleOnly && inTable ? (
    <div ref={setTableMenuAnchor} style={{ position: 'relative', alignSelf: 'flex-start', display: 'flex' }}>
      <Pressable
        testID="editor-table-menu-toggle"
        accessibilityRole="button"
        accessibilityLabel={tableMenuOpen ? t('editor.visual.table.menu.hide', locale) : t('editor.visual.table.menu.show', locale)}
        accessibilityState={{ selected: tableMenuOpen }}
        onPress={() => setTableMenuOpen((open) => !open)}
        style={({ pressed }) => [styles.tableMenuButton, {
          borderColor: tableMenuOpen ? colors.selection : colors.border,
          backgroundColor: tableMenuOpen ? colors.accent : colors.surface,
          opacity: pressed ? 0.7 : 1,
        }]}
      >
        <Text style={[styles.toolText, { color: colors.textPrimary }]}>{t('editor.visual.table.menu.show', locale)}</Text>
      </Pressable>
      {tableMenuOpen && tableMenuAnchor ? (
        <TableContextMenu
          anchor={tableMenuAnchor}
          actions={tableMenuActions}
          colors={colors}
          onClose={(restoreFocus) => {
            setTableMenuOpen(false);
            if (restoreFocus) requestAnimationFrame(() => tableMenuAnchor.querySelector<HTMLElement>('[data-testid="editor-table-menu-toggle"]')?.focus());
          }}
        />
      ) : null}
    </div>
  ) : null;
  return (
    <View>
      <View accessibilityRole="toolbar" accessibilityLabel={t('editor.visual.toolbar', locale)} style={styles.toolbar}>
        {titleOnly ? null : <select
          aria-label={t('editor.visual.block', locale)}
          disabled={inTable}
          value={block.startsWith('heading-') || block === 'paragraph' ? block : 'paragraph'}
          onChange={(event) => chooseBlock(event.currentTarget.value as BlockKind)}
          style={{ height: 44, minWidth: 116, border: `2px solid ${colors.border}`, background: colors.surface, color: colors.textPrimary, fontWeight: 700, padding: '0 8px', opacity: inTable ? 0.45 : 1 }}
        >
          <option value="paragraph">{t('editor.visual.paragraph', locale)}</option>
          {([1, 2, 3, 4, 5, 6] as const).map((level) => <option key={level} value={`heading-${level}`}>{`${t('editor.visual.heading', locale)} ${level}`}</option>)}
        </select>}
        {tableMenuControl}
        {button('B', t('editor.visual.bold', locale), bold, false, () => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'); })}
        {button('I', t('editor.visual.italic', locale), italic, false, () => { editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'); })}
        {compactFormat ? null : <View style={[styles.separator, { backgroundColor: colors.gridLine }]} />}
        {compactFormat ? null : button('•', t('editor.visual.bullet', locale), block === 'bullet', inTable, () => chooseBlock('bullet'))}
        {compactFormat ? null : button('1.', t('editor.visual.ordered', locale), block === 'ordered', inTable, () => chooseBlock('ordered'))}
        {compactFormat ? null : button('☐', t('editor.visual.checklist', locale), block === 'checklist', inTable, () => chooseBlock('checklist'))}
        {compactFormat ? null : alignmentControls}
        {compactFormat ? null : linkImageTableControls}
        {compactFormat ? null : <View style={[styles.separator, { backgroundColor: colors.gridLine }]} />}
        {compactFormat ? null : button('↶', t('editor.visual.undo', locale), false, !canUndo, () => { editor.dispatchCommand(UNDO_COMMAND, undefined); })}
        {compactFormat ? null : button('↷', t('editor.visual.redo', locale), false, !canRedo, () => { editor.dispatchCommand(REDO_COMMAND, undefined); })}
        {compactFormat ? (
          <Pressable
            testID="editor-more-format-toggle"
            accessibilityRole="button"
            accessibilityLabel={moreOpen ? t('editor.visual.more.hide', locale) : t('editor.visual.more.show', locale)}
            accessibilityState={{ selected: moreOpen }}
            onPress={() => setMoreOpen((open) => !open)}
            style={({ pressed }) => [styles.toolButton, {
              borderColor: moreOpen ? colors.selection : colors.border,
              backgroundColor: moreOpen ? colors.accent : colors.surface,
              opacity: pressed ? 0.7 : 1,
            }]}
          >
            <Text style={[styles.toolText, { color: colors.textPrimary }]}>⋯</Text>
          </Pressable>
        ) : null}
      </View>
      {compactFormat && moreOpen ? (
        <View testID="editor-more-format-row" accessibilityRole="toolbar" accessibilityLabel={t('editor.visual.more.show', locale)} style={[styles.toolbar, styles.compactMoreToolbar]}>
          {button('•', t('editor.visual.bullet', locale), block === 'bullet', inTable, () => chooseBlock('bullet'))}
          {button('1.', t('editor.visual.ordered', locale), block === 'ordered', inTable, () => chooseBlock('ordered'))}
          {button('☐', t('editor.visual.checklist', locale), block === 'checklist', inTable, () => chooseBlock('checklist'))}
          {alignmentControls}
          {linkImageTableControls}
          <View style={[styles.separator, { backgroundColor: colors.gridLine }]} />
          {button('↶', t('editor.visual.undo', locale), false, !canUndo, () => { editor.dispatchCommand(UNDO_COMMAND, undefined); })}
          {button('↷', t('editor.visual.redo', locale), false, !canRedo, () => { editor.dispatchCommand(REDO_COMMAND, undefined); })}
        </View>
      ) : null}
      {linkOpen ? (
        <View style={[styles.linkEditor, { borderColor: linkProblem ? colors.danger : colors.gridLine, backgroundColor: colors.surface }]}>
          <TextInput
            autoFocus
            accessibilityLabel={t('editor.visual.link.url', locale)}
            value={linkHref}
            onChangeText={(value) => { setLinkHref(value); setLinkProblem(false); }}
            onSubmitEditing={applyLink}
            placeholder="https://example.com"
            placeholderTextColor={colors.textSecondary}
            style={[styles.linkInput, { color: colors.textPrimary, borderColor: colors.border }]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={t('editor.visual.link.apply', locale)} onPress={applyLink} style={[styles.linkAction, { borderColor: colors.border }]}>
            <Text style={[styles.linkActionText, { color: colors.textPrimary }]}>{t('editor.visual.link.apply', locale)}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('editor.visual.link.remove', locale)} disabled={selectionLink === ''} onPress={removeLink} style={[styles.linkAction, { borderColor: colors.border, opacity: selectionLink === '' ? 0.45 : 1 }]}>
            <Text style={[styles.linkActionText, { color: colors.textPrimary }]}>{t('editor.visual.link.remove', locale)}</Text>
          </Pressable>
          {button('×', t('editor.visual.link.close', locale), false, false, () => setLinkOpen(false))}
          {linkProblem ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>{t('editor.visual.link.invalid', locale)}</Text> : null}
        </View>
      ) : null}
      {!titleOnly && tableOpen ? (
        <View style={[styles.tableEditor, { borderColor: colors.gridLine, backgroundColor: colors.surface }]}>
          <Text style={[styles.tableLabel, { color: colors.textPrimary }]}>{t('editor.visual.table.rows', locale)}</Text>
          <TextInput
            accessibilityLabel={t('editor.visual.table.rows', locale)}
            keyboardType="number-pad"
            value={tableRows}
            onChangeText={setTableRows}
            style={[styles.tableInput, { color: colors.textPrimary, borderColor: colors.border }]}
          />
          <Text style={[styles.tableLabel, { color: colors.textPrimary }]}>{t('editor.visual.table.columns', locale)}</Text>
          <TextInput
            accessibilityLabel={t('editor.visual.table.columns', locale)}
            keyboardType="number-pad"
            value={tableColumns}
            onChangeText={setTableColumns}
            onSubmitEditing={insertTable}
            style={[styles.tableInput, { color: colors.textPrimary, borderColor: colors.border }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('editor.visual.table.insert', locale)}
            accessibilityState={{ disabled: !validTableSize }}
            disabled={!validTableSize}
            onPress={insertTable}
            style={[styles.linkAction, { borderColor: colors.border, opacity: validTableSize ? 1 : 0.45 }]}
          >
            <Text style={[styles.linkActionText, { color: colors.textPrimary }]}>{t('editor.visual.table.insert', locale)}</Text>
          </Pressable>
          {button('×', t('editor.visual.table.close', locale), false, false, () => setTableOpen(false))}
          <Text style={[styles.tableHint, { color: colors.textSecondary }]}>{t('editor.visual.table.hint', locale)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ImageEditorBridge({ images, captionPosition, onReplaceImage, onOpenFullEditor, children }: Pick<RichTextEditorProps, 'images' | 'captionPosition' | 'onReplaceImage' | 'onOpenFullEditor'> & { readonly children: ReactNode }) {
  const [editor] = useLexicalComposerContext();
  const replace = onReplaceImage ? async (blockIndex: number) => {
    const document = editor.getEditorState().read(() => $readWebRichTextDocument());
    return document ? onReplaceImage(document, blockIndex) : null;
  } : undefined;
  return (
    <RichTextImageProvider value={{ images: images ?? new Map(), captionPosition: captionPosition ?? 'bottom', onReplace: replace, onOpenFullEditor }}>
      {children}
    </RichTextImageProvider>
  );
}

function SafePastePlugin({ titleOnly = false }: Pick<RichTextEditorProps, 'titleOnly'>) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(PASTE_COMMAND, (event) => {
    const clipboard = event instanceof ClipboardEvent ? event.clipboardData : event instanceof InputEvent ? event.dataTransfer : null;
    if (!clipboard) return false;
    const html = clipboard.getData('text/html');
    const text = clipboard.getData('text/plain');
    if (html === '' && text === '') return false;
    event.preventDefault();
    $insertNodes(titleOnly ? [$createTextNode(text.replace(/\s+/g, ' ').trim())] : $createWebRichTextNodes(parsePastedRichText(html, text)));
    return true;
  }, COMMAND_PRIORITY_HIGH), [editor, titleOnly]);
  return null;
}

function DocumentChanges({ initialDocument, onChange }: Pick<RichTextEditorProps, 'document' | 'onChange'> & { readonly initialDocument: RichTextEditorProps['document'] }) {
  const [editor] = useLexicalComposerContext();
  const [initialSignature] = useState(() => JSON.stringify(initialDocument));
  const lastSignature = useRef(initialSignature);
  const changed = useRef(false);
  const latestState = useRef<EditorState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publish = useCallback((editorState: EditorState) => {
    let next = null;
    editorState.read(() => { next = $readWebRichTextDocument(); });
    if (next === null) return;
    const signature = JSON.stringify(next);
    if (!changed.current && signature === initialSignature) return;
    if (signature === lastSignature.current) return;
    changed.current = true;
    lastSignature.current = signature;
    onChange(next);
  }, [initialSignature, onChange]);
  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const state = latestState.current;
    latestState.current = null;
    if (state) publish(state);
  }, [publish]);
  useEffect(() => editor.registerCommand(BLUR_COMMAND, () => {
    flush();
    return false;
  }, COMMAND_PRIORITY_LOW), [editor, flush]);
  useEffect(() => () => flush(), [flush]);
  return (
    <OnChangePlugin
      ignoreSelectionChange
      onChange={(editorState) => {
        latestState.current = editorState;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 150);
      }}
    />
  );
}

const editorTheme = {
  heading: { h1: 'nouty-h1', h2: 'nouty-h2', h3: 'nouty-h3', h4: 'nouty-h4', h5: 'nouty-h5', h6: 'nouty-h6' },
  link: 'nouty-link',
  list: {
    checklist: 'nouty-checklist', listitem: 'nouty-listitem', listitemChecked: 'nouty-checked', listitemUnchecked: 'nouty-unchecked',
    nested: { listitem: 'nouty-nested-listitem' }, ol: 'nouty-ol', ul: 'nouty-ul',
  },
  table: 'nouty-table',
  tableScrollableWrapper: 'nouty-table-scroll',
  tableCell: 'nouty-table-cell',
  tableCellHeader: 'nouty-table-cell-header',
};

export function RichTextEditor({ cardId, document, onChange, images = new Map(), captionPosition = 'bottom', fontFamily, onInsertImage, onReplaceImage, onOpenFullEditor, compact = false, toolbarCollapsed = false, titleOnly = false }: RichTextEditorProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [problem, setProblem] = useState<string | null>(null);
  const [initialDocument] = useState(document);
  const [initialConfig] = useState(() => ({
    namespace: `noutynotes-card-${cardId}`,
    nodes: [HeadingNode, LinkNode, ListNode, ListItemNode, RichTextImageNode, TableNode, TableRowNode, TableCellNode],
    theme: editorTheme,
    editorState: () => $loadWebRichTextDocument(initialDocument),
    onError: (error: Error) => setProblem(error.message),
  }));

  return (
    <View testID="web-rich-text-editor" style={[styles.shell, compact ? styles.shellCompact : null, { borderColor: colors.border, backgroundColor: colors.cardSurface }]}>
      <style>{`
        .nouty-h1,.nouty-h2,.nouty-h3,.nouty-h4,.nouty-h5,.nouty-h6{font-weight:800;margin:0 0 .35em}
        .nouty-h1{font-size:2em}.nouty-h2{font-size:1.65em}.nouty-h3{font-size:1.4em}.nouty-h4{font-size:1.2em}.nouty-h5{font-size:1.05em}.nouty-h6{font-size:1em}
        .nouty-link{text-decoration:underline}.nouty-ul,.nouty-ol{margin:.35em 0;padding-left:1.6em}
        .nouty-listitem{margin:.2em 0}.nouty-checklist{list-style:none;padding-left:.3em}
        .nouty-unchecked,.nouty-checked{position:relative;list-style:none;padding-left:1.7em}.nouty-unchecked:before,.nouty-checked:before{position:absolute;box-sizing:border-box;left:0;top:.08em;width:1.25em;height:1.25em;cursor:pointer}
        .nouty-unchecked:before{content:'☐'}.nouty-checked:before{content:'☑'}
        .nouty-table{border-collapse:collapse;table-layout:fixed;width:max-content;min-width:100%;margin:.5em 0}
        .nouty-table-scroll{overflow-x:auto;max-width:100%}
        .nouty-table-cell{border:1px solid ${colors.border};min-width:96px;padding:7px;vertical-align:top;background:${colors.cardSurface};color:${colors.cardText}}
        .nouty-table-cell-header{background:${colors.surfaceRaised};color:${colors.textPrimary};font-weight:800}
        .nouty-table-cell p{margin:0;min-height:1.5em}
        [data-testid="web-rich-text-content"]{overflow-x:auto}
      `}</style>
      <LexicalComposer initialConfig={initialConfig}>
        <ImageEditorBridge images={images} captionPosition={captionPosition} onReplaceImage={onReplaceImage} onOpenFullEditor={onOpenFullEditor}>
        <View
          testID="editor-toolbar"
          accessibilityElementsHidden={toolbarCollapsed}
          importantForAccessibility={toolbarCollapsed ? 'no-hide-descendants' : 'auto'}
          style={toolbarCollapsed ? styles.toolbarCollapsed : null}
        >
          <EditorToolbar onInsertImage={onInsertImage} titleOnly={titleOnly} compact={compact} collapsed={toolbarCollapsed} />
        </View>
        <View testID="web-rich-text-scroll" style={[styles.editArea, compact ? styles.editAreaCompact : null]}>
          <RichTextPlugin
            contentEditable={(
              <ContentEditable
                aria-label={titleOnly ? t('inspector.title.label', locale) : t('editor.visual.content', locale)}
                data-testid="web-rich-text-content"
                spellCheck
                style={{
                  boxSizing: 'border-box', minHeight: titleOnly ? 56 : compact ? 96 : 220, outline: 'none', padding: 14,
                  color: colors.cardText,
                  fontFamily: fontFamily ?? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                  fontSize: 16, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                  ...(compact ? { height: '100%', overflowY: 'auto' } : {}),
                }}
              />
            )}
            placeholder={<span style={{ position: 'absolute', left: 14, top: 14, color: colors.textSecondary, pointerEvents: 'none' }}>{t('editor.visual.placeholder', locale)}</span>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </View>
        <HistoryPlugin delay={700} />
        <ListPlugin shouldPreserveNumbering />
        <CheckListPlugin />
        <LinkPlugin validateUrl={isLinkUrl} attributes={{ rel: 'noreferrer' }} />
        <TablePlugin hasCellMerge={false} hasCellBackgroundColor={false} hasTabHandler hasHorizontalScroll />
        <SafePastePlugin titleOnly={titleOnly} />
        <AutoFocusPlugin />
        <DocumentChanges document={document} initialDocument={initialDocument} onChange={onChange} />
        </ImageEditorBridge>
      </LexicalComposer>
      {/* UX7-CONSOLIDATION: guardar correctamente es silencioso (mismo criterio que el resto de la
          app) — esta línea ya no repite «los cambios se guardan automáticamente» en cada fotograma;
          solo aparece ante un error real del propio editor (`onError` de Lexical). */}
      {problem ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.status, { color: colors.danger }]}>
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { width: '100%', borderWidth: 2, minHeight: 0 },
  // En edición rápida la altura la impone la tarjeta. `flexBasis: 0` evita que el contenido de
  // Lexical agrande este contenedor y desplace su principio fuera del marco; sólo `editArea` desplaza.
  shellCompact: { flex: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden' },
  toolbar: { minHeight: 52, padding: 8, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  compactMoreToolbar: { minHeight: 48, padding: 4, gap: 4 },
  toolbarCollapsed: { display: 'none' },
  tableMenuButton: { height: 44, paddingHorizontal: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  toolButton: { width: 44, height: 44, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  alignmentGroup: { flexDirection: 'row', gap: 4, paddingLeft: 6, borderLeftWidth: 1 },
  alignmentIcon: { width: 24, gap: 3 },
  alignLeft: { alignItems: 'flex-start' },
  alignCenter: { alignItems: 'center' },
  alignRight: { alignItems: 'flex-end' },
  alignmentLine: { height: 2 },
  toolText: { fontSize: 17 },
  bold: { fontWeight: '900' },
  italic: { fontStyle: 'italic' },
  separator: { width: 1, height: 30, marginHorizontal: 2 },
  linkEditor: { minHeight: 54, borderTopWidth: 1, borderBottomWidth: 1, padding: 6, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  linkInput: { minWidth: 220, flexGrow: 1, height: 44, borderWidth: 2, paddingHorizontal: 10 },
  linkAction: { minHeight: 44, borderWidth: 2, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  linkActionText: { fontSize: 13, fontWeight: '800' },
  tableEditor: { minHeight: 54, borderTopWidth: 1, borderBottomWidth: 1, padding: 6, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  tableLabel: { fontSize: 13, fontWeight: '700' },
  tableInput: { width: 64, height: 44, borderWidth: 2, paddingHorizontal: 10 },
  tableHint: { flexBasis: '100%', fontSize: 12 },
  editArea: { position: 'relative', minHeight: 220, maxHeight: 420, overflow: 'scroll' },
  editAreaCompact: { flex: 1, flexBasis: 0, minHeight: 0, maxHeight: undefined, overflow: 'hidden' },
  status: { minHeight: 30, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12 },
});
