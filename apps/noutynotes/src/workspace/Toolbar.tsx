import { useTheme } from '@noutynotes/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ToolButton } from '../components/controls';
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
 * están en Configuración.
 */
export function Toolbar(props: ToolbarProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const onCanvas = props.view === 'canvas';
  const cell = props.compact ? styles.compactCell : styles.wideCell;
  const tools = (
    <View style={styles.group}>
      <ToolButton glyph="↖" label="Seleccionar" accessibilityLabel="Herramienta Seleccionar" accessibilityHint="Toca para editar; arrastra para mover y usa las asas para cambiar el tamaño"
        active={props.tool === 'select'} disabled={!onCanvas} onPress={() => props.onTool('select')} style={cell} />
      <ToolButton glyph="✋" label="Mano" accessibilityLabel="Herramienta Mano" accessibilityHint="Arrastra para desplazar el lienzo"
        active={props.tool === 'pan'} disabled={!onCanvas} onPress={() => props.onTool('pan')} style={cell} />
      <ToolButton glyph="⤳" label="Conectar" accessibilityLabel="Herramienta Conectar" accessibilityHint="Toca el origen y después otra tarjeta para conectar o desconectar"
        active={props.tool === 'connect'} disabled={!onCanvas} onPress={() => props.onTool('connect')} style={cell} />
      <ToolButton testID="open-search" glyph="⌕" label="Buscar" accessibilityLabel="Abrir la búsqueda" accessibilityHint="En este proyecto o en todos: palabras, #etiqueta, enlaces y tipos"
        onPress={props.onOpenSearch} style={cell} />
      {props.compact ? (
        <>
          <ToolButton glyph="≡" label="Lista" accessibilityLabel="Vista de lista" active={!onCanvas} onPress={props.onToggleView} style={cell} />
          <ToolButton glyph="☰" label="Más" accessibilityLabel="Más secciones" accessibilityHint="Diario, Archivo, Assets y Configuración" onPress={props.onOpenMore} style={cell} />
        </>
      ) : null}
    </View>
  );
  const create = (
    <View style={styles.group}>
      <ToolButton glyph="+" label="Nota" accessibilityLabel="Añadir nota" onPress={props.onAddNote} style={cell} />
      <ToolButton glyph="T" label="Título" accessibilityLabel="Añadir título flotante" onPress={props.onAddTitle} style={cell} />
      <ToolButton glyph="↗" label="Enlace" accessibilityLabel="Añadir enlace" accessibilityHint="Una dirección web o de correo; no se descarga nada" onPress={props.onAddLink} style={cell} />
      <ToolButton glyph="⤒" label="Imagen" accessibilityLabel="Importar una imagen" accessibilityHint="Elige una imagen PNG, JPEG, GIF o WebP de hasta 5 MB" onPress={props.onImportImage} style={cell} />
      <ToolButton glyph="▣" label="Ejemplo" accessibilityLabel="Añadir imagen de ejemplo" accessibilityHint="Marcador de demostración sin archivo" onPress={props.onAddExample} style={cell} />
      {props.compact ? (
        <>
          <ToolButton glyph="🗑" label={props.trashCount > 0 ? `Papelera ${props.trashCount}` : 'Papelera'} accessibilityLabel={`Abrir la Papelera (${props.trashCount})`} onPress={props.onOpenTrash} style={cell} />
        </>
      ) : null}
    </View>
  );
  const history = props.compact ? null : (
    <View style={styles.group}>
      <ToolButton glyph="↶" label="Deshacer" accessibilityLabel={props.undoLabel ? `Deshacer: ${props.undoLabel}` : 'Deshacer'}
        accessibilityHint="Ctrl + Z" disabled={props.undoLabel === null} onPress={props.onUndo} style={cell} />
      <ToolButton glyph="↷" label="Rehacer" accessibilityLabel={props.redoLabel ? `Rehacer: ${props.redoLabel}` : 'Rehacer'}
        accessibilityHint="Ctrl + Mayús + Z" disabled={props.redoLabel === null} onPress={props.onRedo} style={cell} />
    </View>
  );
  const view = props.compact ? null : (
    <View style={styles.group}>
      <ToolButton glyph="−" label="Alejar" accessibilityLabel="Alejar" disabled={!onCanvas || props.zoom <= MIN_ZOOM} onPress={props.onZoomOut} style={cell} />
      <ToolButton testID="zoom-level" glyph={formatZoom(props.zoom)} label="Zoom" accessibilityLabel={`Zoom ${formatZoom(props.zoom)}, restablecer a 100 %`}
        disabled={!onCanvas} onPress={props.onZoomReset} style={[cell, styles.zoomCell]} />
      <ToolButton glyph="+" label="Acercar" accessibilityLabel="Acercar" disabled={!onCanvas || props.zoom >= MAX_ZOOM} onPress={props.onZoomIn} style={cell} />
      <ToolButton glyph="≡" label="Lista" accessibilityLabel="Vista de lista" active={!onCanvas} onPress={props.onToggleView} style={cell} />
      {props.navInSidebar ? null : (
        <>
          <ToolButton glyph="🗑" label={props.trashCount > 0 ? `Papelera ${props.trashCount}` : 'Papelera'} accessibilityLabel={`Abrir la Papelera (${props.trashCount})`} onPress={props.onOpenTrash} style={cell} />
          <ToolButton glyph="◷" label="Diario" accessibilityLabel="Abrir el diario" onPress={props.onOpenDiary} style={cell} />
          <ToolButton glyph="▤" label={props.archiveCount > 0 ? `Archivo ${props.archiveCount}` : 'Archivo'} accessibilityLabel={`Abrir el Archivo (${props.archiveCount})`} onPress={props.onOpenArchive} style={cell} />
          <ToolButton glyph="▦" label="Assets" accessibilityLabel="Abrir los assets" onPress={props.onOpenAssets} style={cell} />
          <ToolButton glyph="⚙" label="Configuración" accessibilityLabel="Abrir la configuración" onPress={props.onOpenSettings} style={cell} />
        </>
      )}
    </View>
  );
  return (
    <View
      testID="workspace-toolbar"
      accessibilityRole="toolbar"
      accessibilityLabel="Herramientas del tablero"
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
