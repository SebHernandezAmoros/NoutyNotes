import { useTheme } from '@noutynotes/ui';
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
}

/**
 * Barra de herramientas real (ADR 0013, ADR 0014). Cada botón ejecuta una acción. En compacto va
 * abajo en dos filas (herramientas y crear/ver); el zoom está en Configuración. Grilla e imán se
 * configuran en Configuración.
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
      {props.compact ? (
        <ToolButton glyph="⚙" label="Ajustes" accessibilityLabel="Abrir la configuración" onPress={props.onOpenSettings} style={cell} />
      ) : null}
    </View>
  );
  const create = (
    <View style={styles.group}>
      <ToolButton glyph="+" label="Nota" accessibilityLabel="Añadir nota" onPress={props.onAddNote} style={cell} />
      <ToolButton glyph="⤒" label="Imagen" accessibilityLabel="Importar una imagen" accessibilityHint="Elige una imagen PNG, JPEG, GIF o WebP de hasta 5 MB" onPress={props.onImportImage} style={cell} />
      <ToolButton glyph="▣" label="Ejemplo" accessibilityLabel="Añadir imagen de ejemplo" accessibilityHint="Marcador de demostración sin archivo" onPress={props.onAddExample} style={cell} />
      {props.compact ? (
        <>
          <ToolButton glyph="≡" label="Lista" accessibilityLabel="Vista de lista" active={!onCanvas} onPress={props.onToggleView} style={cell} />
          <ToolButton glyph="🗑" label={props.trashCount > 0 ? `Papelera ${props.trashCount}` : 'Papelera'} accessibilityLabel={`Abrir la Papelera (${props.trashCount})`} onPress={props.onOpenTrash} style={cell} />
        </>
      ) : null}
    </View>
  );
  const view = props.compact ? null : (
    <View style={styles.group}>
      <ToolButton glyph="−" label="Alejar" accessibilityLabel="Alejar" disabled={!onCanvas || props.zoom <= MIN_ZOOM} onPress={props.onZoomOut} style={cell} />
      <ToolButton testID="zoom-level" glyph={formatZoom(props.zoom)} label="Zoom" accessibilityLabel={`Zoom ${formatZoom(props.zoom)}, restablecer a 100 %`}
        disabled={!onCanvas} onPress={props.onZoomReset} style={[cell, styles.zoomCell]} />
      <ToolButton glyph="+" label="Acercar" accessibilityLabel="Acercar" disabled={!onCanvas || props.zoom >= MAX_ZOOM} onPress={props.onZoomIn} style={cell} />
      <ToolButton glyph="≡" label="Lista" accessibilityLabel="Vista de lista" active={!onCanvas} onPress={props.onToggleView} style={cell} />
      <ToolButton glyph="🗑" label={props.trashCount > 0 ? `Papelera ${props.trashCount}` : 'Papelera'} accessibilityLabel={`Abrir la Papelera (${props.trashCount})`} onPress={props.onOpenTrash} style={cell} />
      <ToolButton glyph="⚙" label="Configuración" accessibilityLabel="Abrir la configuración" onPress={props.onOpenSettings} style={cell} />
    </View>
  );
  return (
    <View
      testID="workspace-toolbar"
      accessibilityRole="toolbar"
      accessibilityLabel="Herramientas del tablero"
      style={[styles.bar, props.compact ? styles.compact : styles.wide, { backgroundColor: colors.surface, borderColor: colors.border }]}
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
          {create}
          <View style={[styles.divider, { backgroundColor: colors.gridLine }]} />
          {view}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderWidth: 2, padding: 4, gap: 4 },
  compact: { flexDirection: 'column' },
  wide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  // Compacto: celdas iguales que reparten el ancho (390 px sin desbordar); amplio: ancho natural.
  compactCell: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingHorizontal: 2 },
  wideCell: { paddingHorizontal: 10 },
  zoomCell: { minWidth: 64 },
  divider: { width: 2, alignSelf: 'stretch', marginHorizontal: 4 },
});
