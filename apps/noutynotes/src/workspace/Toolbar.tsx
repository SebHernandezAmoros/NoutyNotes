import { useLocale, useTheme } from '@noutynotes/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ToolButton } from '../components/controls';
import { t } from '../i18n';
import type { CanvasTool } from './canvas/Canvas';
import { MAX_ZOOM, MIN_ZOOM, formatZoom } from './canvas/viewport';

export type BoardView = 'canvas' | 'list';

interface ToolbarProps {
  readonly compact: boolean;
  readonly tool: CanvasTool;
  readonly onTool: (tool: CanvasTool) => void;
  readonly onAddNote: () => void;
  readonly onAddTitle: () => void;
  readonly onAddLink: () => void;
  readonly onImportImage: () => void;
  readonly onAddExample: () => void;
  readonly onAddBoardShortcut: () => void;
  readonly zoom: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomReset: () => void;
  readonly view: BoardView;
  readonly onToggleView: () => void;
  readonly trashCount: number;
  readonly onOpenTrash: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenAssets: () => void;
  readonly onOpenArchive: () => void;
  readonly onOpenDiary: () => void;
  readonly onOpenPresent: () => void;
  /** «Imprimir» es solo web (ADR 0031); en otras plataformas no se muestra. */
  readonly canPrint: boolean;
  readonly onOpenPrint: () => void;
  readonly archiveCount: number;
  /** Móvil: «Más» abre la hoja de secciones (Assets, Configuración…; ADR 0022). */
  readonly onOpenMore: () => void;
  readonly onOpenSearch: () => void;
  /** Deshacer y rehacer (ADR 0026): el nombre de la acción, o null si no hay. En móvil van en la línea de aviso. */
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** Con barra lateral (≥ 1100 px), Papelera y Configuración están en ella y no se repiten aquí. */
  readonly navInSidebar: boolean;
  /** Contenido al final de la fila en escritorio (el aviso del workspace): ahorra una fila al lienzo. */
  readonly trailing?: ReactNode;
}

/**
 * Barra de herramientas real (ADR 0013, ADR 0014). Cada botón ejecuta una acción. En compacto va
 * abajo en dos filas de seis (herramientas y vista; crear y Papelera); el zoom, la grilla y el imán
 * están en Configuración. Textos con idioma de interfaz (ADR 0032): el contenido de las notas no cambia.
 */
export function Toolbar(props: ToolbarProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const onCanvas = props.view === 'canvas';
  const cell = props.compact ? styles.compactCell : styles.wideCell;
  const trashLabel = props.trashCount > 0 ? `${t('nav.trash', locale)} ${props.trashCount}` : t('nav.trash', locale);
  const trashOpenLabel = `${t('nav.trash.open', locale)} (${props.trashCount})`;
  const archiveLabel = props.archiveCount > 0 ? `${t('nav.archive', locale)} ${props.archiveCount}` : t('nav.archive', locale);
  const archiveOpenLabel = `${t('nav.archive.open', locale)} (${props.archiveCount})`;
  const tools = (
    <View style={styles.group}>
      <ToolButton glyph="↖" label={t('tool.select', locale)} accessibilityLabel={t('tool.select.label', locale)} accessibilityHint={t('tool.select.hint', locale)}
        active={props.tool === 'select'} disabled={!onCanvas} onPress={() => props.onTool('select')} style={cell} />
      <ToolButton glyph="✋" label={t('tool.pan', locale)} accessibilityLabel={t('tool.pan.label', locale)} accessibilityHint={t('tool.pan.hint', locale)}
        active={props.tool === 'pan'} disabled={!onCanvas} onPress={() => props.onTool('pan')} style={cell} />
      <ToolButton glyph="⤳" label={t('tool.connect', locale)} accessibilityLabel={t('tool.connect.label', locale)} accessibilityHint={t('tool.connect.hint', locale)}
        active={props.tool === 'connect'} disabled={!onCanvas} onPress={() => props.onTool('connect')} style={cell} />
      <ToolButton testID="open-search" glyph="⌕" label={t('tool.search', locale)} accessibilityLabel={t('tool.search.label', locale)} accessibilityHint={t('tool.search.hint', locale)}
        onPress={props.onOpenSearch} style={cell} />
      {props.compact ? (
        <>
          <ToolButton glyph="≡" label={t('view.list', locale)} accessibilityLabel={t('view.list.label', locale)} active={!onCanvas} onPress={props.onToggleView} style={cell} />
          <ToolButton glyph="☰" label={t('more', locale)} accessibilityLabel={t('more.label', locale)} accessibilityHint={t('more.hint', locale)} onPress={props.onOpenMore} style={cell} />
        </>
      ) : null}
    </View>
  );
  const create = (
    <View style={styles.group}>
      <ToolButton glyph="+" label={t('add.note', locale)} accessibilityLabel={t('add.note.label', locale)} onPress={props.onAddNote} style={cell} />
      <ToolButton glyph="T" label={t('add.title', locale)} accessibilityLabel={t('add.title.label', locale)} onPress={props.onAddTitle} style={cell} />
      <ToolButton glyph="▣" label="Tablero" accessibilityLabel="Crear acceso rápido a un tablero" onPress={props.onAddBoardShortcut} style={cell} />
      <ToolButton glyph="↗" label={t('add.link', locale)} accessibilityLabel={t('add.link.label', locale)} accessibilityHint={t('add.link.hint', locale)} onPress={props.onAddLink} style={cell} />
      <ToolButton glyph="⤒" label={t('add.image', locale)} accessibilityLabel={t('add.image.label', locale)} accessibilityHint={t('add.image.hint', locale)} onPress={props.onImportImage} style={cell} />
      <ToolButton glyph="▣" label={t('add.example', locale)} accessibilityLabel={t('add.example.label', locale)} accessibilityHint={t('add.example.hint', locale)} onPress={props.onAddExample} style={cell} />
      {props.compact ? (
        <>
          <ToolButton glyph="🗑" label={trashLabel} accessibilityLabel={trashOpenLabel} onPress={props.onOpenTrash} style={cell} />
        </>
      ) : null}
    </View>
  );
  const history = props.compact ? null : (
    <View style={styles.group}>
      <ToolButton glyph="↶" label={t('undo', locale)} accessibilityLabel={props.undoLabel ? `${t('undo', locale)}: ${props.undoLabel}` : t('undo', locale)}
        accessibilityHint={t('undo.hint', locale)} disabled={props.undoLabel === null} onPress={props.onUndo} style={cell} />
      <ToolButton glyph="↷" label={t('redo', locale)} accessibilityLabel={props.redoLabel ? `${t('redo', locale)}: ${props.redoLabel}` : t('redo', locale)}
        accessibilityHint={t('redo.hint', locale)} disabled={props.redoLabel === null} onPress={props.onRedo} style={cell} />
    </View>
  );
  const view = props.compact ? null : (
    <View style={styles.group}>
      <ToolButton glyph="−" label={t('zoom.out', locale)} accessibilityLabel={t('zoom.out', locale)} disabled={!onCanvas || props.zoom <= MIN_ZOOM} onPress={props.onZoomOut} style={cell} />
      <ToolButton testID="zoom-level" glyph={formatZoom(props.zoom)} label={t('zoom', locale)} accessibilityLabel={`${t('zoom', locale)} ${formatZoom(props.zoom)}${t('zoom.reset.suffix', locale)}`}
        disabled={!onCanvas} onPress={props.onZoomReset} style={[cell, styles.zoomCell]} />
      <ToolButton glyph="+" label={t('zoom.in', locale)} accessibilityLabel={t('zoom.in', locale)} disabled={!onCanvas || props.zoom >= MAX_ZOOM} onPress={props.onZoomIn} style={cell} />
      <ToolButton glyph="≡" label={t('view.list', locale)} accessibilityLabel={t('view.list.label', locale)} active={!onCanvas} onPress={props.onToggleView} style={cell} />
      {props.navInSidebar ? null : (
        <>
          <ToolButton glyph="🗑" label={trashLabel} accessibilityLabel={trashOpenLabel} onPress={props.onOpenTrash} style={cell} />
          <ToolButton glyph="◷" label={t('nav.diary', locale)} accessibilityLabel={t('nav.diary.open', locale)} onPress={props.onOpenDiary} style={cell} />
          <ToolButton glyph="▤" label={archiveLabel} accessibilityLabel={archiveOpenLabel} onPress={props.onOpenArchive} style={cell} />
          <ToolButton glyph="▦" label={t('nav.assets', locale)} accessibilityLabel={t('nav.assets.open', locale)} onPress={props.onOpenAssets} style={cell} />
          <ToolButton glyph="▶" label={t('nav.present', locale)} accessibilityLabel={t('nav.present.open', locale)} onPress={props.onOpenPresent} style={cell} />
          {props.canPrint ? <ToolButton glyph="⎙" label={t('nav.print', locale)} accessibilityLabel={t('nav.print.open', locale)} onPress={props.onOpenPrint} style={cell} /> : null}
          <ToolButton glyph="⚙" label={t('nav.settings', locale)} accessibilityLabel={t('nav.settings.open', locale)} onPress={props.onOpenSettings} style={cell} />
        </>
      )}
    </View>
  );
  return (
    <View
      testID="workspace-toolbar"
      accessibilityRole="toolbar"
      accessibilityLabel={t('toolbar.label', locale)}
      style={[styles.bar, props.compact ? styles.compact : styles.wide, { backgroundColor: colors.surface, borderColor: colors.gridLine }]}
    >
      {props.compact ? (
        <>
          {tools}
          {create}
        </>
      ) : (
        <>
          {tools}
          <View style={[styles.divider, { backgroundColor: colors.gridLine }]} />
          {history}
          <View style={[styles.divider, { backgroundColor: colors.gridLine }]} />
          {create}
          <View style={[styles.divider, { backgroundColor: colors.gridLine }]} />
          {view}
          {props.trailing ? <View style={styles.trailing}>{props.trailing}</View> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderWidth: 1, padding: 4, gap: 4 },
  compact: { flexDirection: 'column' },
  wide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  // Seis por fila y ancho según el texto (el sobrante se reparte): ninguna palabra se parte a 360-390 px.
  compactCell: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: 2 },
  wideCell: { paddingHorizontal: 10 },
  zoomCell: { minWidth: 64 },
  divider: { width: 2, alignSelf: 'stretch', marginHorizontal: 4 },
  trailing: { flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 220, alignSelf: 'stretch', justifyContent: 'center' },
});
