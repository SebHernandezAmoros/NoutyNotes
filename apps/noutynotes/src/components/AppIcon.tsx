import { useTheme } from '@noutynotes/ui';
import { StyleSheet, Text, View } from 'react-native';

export type AppIconName =
  | 'select' | 'pan' | 'connect' | 'search' | 'list' | 'menu'
  | 'note' | 'text' | 'board' | 'link' | 'image' | 'upload'
  | 'trash' | 'undo' | 'redo' | 'minus' | 'plus'
  | 'diary' | 'archive' | 'assets' | 'present' | 'print' | 'settings'
  | 'edit' | 'close' | 'expand' | 'collapse' | 'folder' | 'check' | 'star' | 'frame'
  | 'copy' | 'cut' | 'paste' | 'duplicate';

/**
 * Catálogo de línea portable para la interfaz (ADR 0047). Usa primitivas de React Native y evita
 * emoji/fuentes de iconos, cuyo aspecto cambia entre Chrome, Windows y Android.
 */
export function AppIcon({ name, size = 22, color }: { readonly name: AppIconName; readonly size?: number; readonly color?: string }) {
  const { theme } = useTheme();
  const ink = color ?? theme.colors.textPrimary;
  const line = Math.max(1.5, Math.round(size / 12));
  const common = { borderColor: ink, borderWidth: line };
  const fill = { backgroundColor: ink };
  const box = { width: size, height: size };

  if (name === 'plus' || name === 'minus' || name === 'close') return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.root, box]}>
      <View style={[styles.centerLine, fill, { height: line }]} />
      {name !== 'minus' ? <View style={[styles.centerLine, fill, { height: line, transform: [{ rotate: name === 'close' ? '45deg' : '90deg' }] }]} /> : null}
      {name === 'close' ? <View style={[styles.centerLine, fill, { height: line, transform: [{ rotate: '-45deg' }] }]} /> : null}
    </View>
  );
  if (name === 'check') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.checkShort, fill, { height: line }]} /><View style={[styles.checkLong, fill, { height: line }]} />
    </View>
  );
  if (name === 'star') return <Text accessibilityElementsHidden style={{ color: ink, fontSize: size, lineHeight: size, fontWeight: '700' }}>★</Text>;
  if (name === 'folder') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.folder, common]} /><View style={[styles.folderTab, common, { borderBottomWidth: 0 }]} />
    </View>
  );
  if (name === 'search') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.searchCircle, common, { width: size * 0.62, height: size * 0.62, borderRadius: size }]} />
      <View style={[styles.searchHandle, fill, { width: size * 0.42, height: line }]} />
    </View>
  );
  if (name === 'connect') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.diagonal, fill, { height: line }]} />
      <View style={[styles.node, common, { left: 1, top: size * 0.62, width: size * 0.3, height: size * 0.3, borderRadius: size }]} />
      <View style={[styles.node, common, { right: 1, top: size * 0.08, width: size * 0.3, height: size * 0.3, borderRadius: size }]} />
    </View>
  );
  if (name === 'list' || name === 'menu') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      {[0.25, 0.5, 0.75].map((at) => <View key={at} style={[styles.horizontal, fill, { top: size * at, left: name === 'list' ? size * 0.3 : size * 0.12, right: size * 0.12, height: line }]} />)}
      {name === 'list' ? [0.25, 0.5, 0.75].map((at) => <View key={`d${at}`} style={[styles.dot, fill, { top: size * at - line, left: size * 0.08, width: line * 2, height: line * 2 }]} />) : null}
    </View>
  );
  if (name === 'undo' || name === 'redo') return <Text accessibilityElementsHidden style={{ color: ink, fontSize: size, lineHeight: size, fontWeight: '700' }}>{name === 'undo' ? '↶' : '↷'}</Text>;
  if (name === 'text') return <Text accessibilityElementsHidden style={{ color: ink, fontSize: size, lineHeight: size, fontWeight: '900' }}>T</Text>;
  if (name === 'select') return <Text accessibilityElementsHidden style={{ color: ink, fontSize: size, lineHeight: size, fontWeight: '900' }}>↖</Text>;
  if (name === 'pan') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.palm, common, { width: size * 0.62, height: size * 0.52, borderRadius: size * 0.18 }]} />
      {[0.2, 0.38, 0.56, 0.74].map((left, index) => <View key={left} style={[styles.finger, common, { left: size * left, top: index === 0 ? size * 0.22 : size * 0.08, width: size * 0.16, height: size * 0.55, borderRadius: size }]} />)}
    </View>
  );
  if (name === 'board' || name === 'assets') return (
    <View accessibilityElementsHidden style={[styles.root, box, common]}>
      <View style={[styles.vertical, fill, { left: size / 2 - line / 2, width: line }]} />
      <View style={[styles.horizontal, fill, { top: size / 2 - line / 2, left: 0, right: 0, height: line }]} />
    </View>
  );
  if (name === 'note' || name === 'archive' || name === 'trash' || name === 'print') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[name === 'trash' ? styles.bin : name === 'archive' ? styles.archiveBox : styles.page, common]} />
      {name === 'trash' ? <><View style={[styles.lid, fill, { height: line }]} /><View style={[styles.handle, common]} /></> : null}
      {name === 'archive' ? <View style={[styles.archiveSlot, fill, { height: line }]} /> : null}
      {name === 'note' ? [0.42, 0.62, 0.82].map((top) => <View key={top} style={[styles.pageLine, fill, { top: size * top, height: line }]} />) : null}
      {name === 'print' ? <View style={[styles.printer, common]} /> : null}
    </View>
  );
  if (name === 'diary') return (
    <View accessibilityElementsHidden style={[styles.root, box, common, { borderRadius: size }]}>
      <View style={[styles.clockHand, fill, { width: line, height: size * 0.28 }]} />
      <View style={[styles.clockMinute, fill, { width: size * 0.25, height: line }]} />
    </View>
  );
  if (name === 'image') return (
    <View accessibilityElementsHidden style={[styles.root, box, common, { overflow: 'hidden' }]}>
      <View style={[styles.imageSun, fill]} /><View style={[styles.imageMountain, { borderColor: ink, borderWidth: line }]} />
    </View>
  );
  if (name === 'link') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.chain, common, { left: 0, top: size * 0.38 }]} /><View style={[styles.chain, common, { right: 0, top: size * 0.12 }]} />
    </View>
  );
  if (name === 'upload') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.uploadStem, fill, { width: line }]} /><View style={[styles.uploadHead, { borderLeftWidth: size * 0.22, borderRightWidth: size * 0.22, borderBottomWidth: size * 0.22, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: ink }]} /><View style={[styles.uploadTray, common]} />
    </View>
  );
  if (name === 'present') return (
    <View accessibilityElementsHidden style={[styles.root, box]}><View style={[styles.play, { borderTopWidth: size * 0.34, borderBottomWidth: size * 0.34, borderLeftWidth: size * 0.54, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: ink }]} /></View>
  );
  if (name === 'settings') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.gearRing, common, { borderRadius: size }]} />
      {[0, 45, 90, 135].map((rotate) => <View key={rotate} style={[styles.gearSpoke, fill, { width: line, transform: [{ rotate: `${rotate}deg` }] }]} />)}
    </View>
  );
  if (name === 'edit') return <View accessibilityElementsHidden style={[styles.root, box]}><View style={[styles.pencil, common]} /><View style={[styles.pencilTip, { borderLeftWidth: size * 0.12, borderRightWidth: size * 0.12, borderTopWidth: size * 0.2, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: ink }]} /></View>;
  if (name === 'expand' || name === 'collapse') return (
    <View accessibilityElementsHidden style={[styles.root, box, common]}>{name === 'collapse' ? <View style={[styles.centerLine, fill, { height: line }]} /> : <View style={[styles.innerSquare, common]} />}</View>
  );
  if (name === 'copy' || name === 'duplicate') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.copyBack, common]} />
      <View style={[styles.copyFront, common]} />
      {name === 'duplicate' ? (
        <>
          <View style={[styles.duplicateBadge, fill, { height: line }]} />
          <View style={[styles.duplicateBadge, fill, { height: line, transform: [{ rotate: '90deg' }] }]} />
        </>
      ) : null}
    </View>
  );
  if (name === 'cut') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.scissorBlade, fill, { height: line, transform: [{ rotate: '40deg' }] }]} />
      <View style={[styles.scissorBlade, fill, { height: line, transform: [{ rotate: '-40deg' }] }]} />
      <View style={[styles.node, common, { left: '6%', top: '58%', width: size * 0.32, height: size * 0.32, borderRadius: size }]} />
      <View style={[styles.node, common, { right: '6%', top: '58%', width: size * 0.32, height: size * 0.32, borderRadius: size }]} />
    </View>
  );
  if (name === 'paste') return (
    <View accessibilityElementsHidden style={[styles.root, box]}>
      <View style={[styles.clipboardBody, common]} />
      <View style={[styles.clipboardClip, common]} />
      {[0.52, 0.68].map((top) => <View key={top} style={[styles.pageLine, fill, { top: size * top, left: '28%', right: '28%', height: line }]} />)}
    </View>
  );
  if (name === 'frame') {
    const bracket = size * 0.32;
    return (
      <View accessibilityElementsHidden style={[styles.root, box]}>
        <View style={[styles.frameH, fill, { height: line, top: 0, left: 0, width: bracket }]} />
        <View style={[styles.frameV, fill, { width: line, top: 0, left: 0, height: bracket }]} />
        <View style={[styles.frameH, fill, { height: line, top: 0, right: 0, width: bracket }]} />
        <View style={[styles.frameV, fill, { width: line, top: 0, right: 0, height: bracket }]} />
        <View style={[styles.frameH, fill, { height: line, bottom: 0, left: 0, width: bracket }]} />
        <View style={[styles.frameV, fill, { width: line, bottom: 0, left: 0, height: bracket }]} />
        <View style={[styles.frameH, fill, { height: line, bottom: 0, right: 0, width: bracket }]} />
        <View style={[styles.frameV, fill, { width: line, bottom: 0, right: 0, height: bracket }]} />
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  root: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  centerLine: { position: 'absolute', left: '15%', right: '15%' },
  horizontal: { position: 'absolute' }, vertical: { position: 'absolute', top: 0, bottom: 0 }, dot: { position: 'absolute', borderRadius: 20 },
  searchCircle: { position: 'absolute', left: 1, top: 1 }, searchHandle: { position: 'absolute', right: 0, bottom: 3, transform: [{ rotate: '45deg' }] },
  diagonal: { position: 'absolute', left: '18%', right: '18%', transform: [{ rotate: '-35deg' }] }, node: { position: 'absolute', backgroundColor: 'transparent' },
  palm: { position: 'absolute', left: '20%', bottom: '5%', backgroundColor: 'transparent' }, finger: { position: 'absolute', backgroundColor: 'transparent' },
  page: { position: 'absolute', left: '18%', top: '4%', width: '64%', height: '92%', backgroundColor: 'transparent' }, pageLine: { position: 'absolute', left: '30%', right: '28%' },
  bin: { position: 'absolute', left: '24%', top: '27%', width: '52%', height: '67%', backgroundColor: 'transparent' }, lid: { position: 'absolute', left: '17%', right: '17%', top: '20%' }, handle: { position: 'absolute', left: '39%', right: '39%', top: '7%', height: '14%' },
  archiveBox: { position: 'absolute', left: '8%', top: '26%', width: '84%', height: '62%' },
  printer: { position: 'absolute', left: '7%', right: '7%', top: '40%', height: '42%', backgroundColor: 'transparent' },
  archiveSlot: { position: 'absolute', left: '34%', right: '34%', top: '47%' },
  clockHand: { position: 'absolute', top: '20%' }, clockMinute: { position: 'absolute', left: '50%', top: '49%' },
  imageSun: { position: 'absolute', width: '18%', height: '18%', borderRadius: 20, right: '14%', top: '14%' }, imageMountain: { position: 'absolute', width: '58%', height: '58%', left: '12%', bottom: '-28%', transform: [{ rotate: '45deg' }] },
  chain: { position: 'absolute', width: '58%', height: '34%', borderRadius: 20, transform: [{ rotate: '-35deg' }] },
  uploadStem: { position: 'absolute', top: '12%', bottom: '36%' }, uploadHead: { position: 'absolute', top: '6%', width: 0, height: 0 }, uploadTray: { position: 'absolute', left: '10%', right: '10%', bottom: '5%', height: '28%', borderTopWidth: 0 },
  play: { width: 0, height: 0, marginLeft: '12%' },
  gearRing: { position: 'absolute', width: '48%', height: '48%' }, gearSpoke: { position: 'absolute', height: '96%' },
  pencil: { width: '24%', height: '72%', transform: [{ rotate: '45deg' }] }, pencilTip: { position: 'absolute', right: '5%', bottom: '2%', width: 0, height: 0, transform: [{ rotate: '-45deg' }] },
  innerSquare: { width: '56%', height: '56%' },
  checkShort: { position: 'absolute', left: '12%', width: '36%', transform: [{ rotate: '45deg' }] },
  checkLong: { position: 'absolute', left: '32%', width: '62%', transform: [{ rotate: '-45deg' }] },
  folder: { position: 'absolute', left: '4%', right: '4%', top: '30%', bottom: '5%', backgroundColor: 'transparent' },
  folderTab: { position: 'absolute', left: '4%', top: '12%', width: '44%', height: '22%', backgroundColor: 'transparent' },
  frameH: { position: 'absolute' },
  frameV: { position: 'absolute' },
  copyBack: { position: 'absolute', right: '8%', top: '8%', width: '68%', height: '68%', borderRadius: 3, backgroundColor: 'transparent' },
  copyFront: { position: 'absolute', left: '8%', bottom: '8%', width: '68%', height: '68%', borderRadius: 3, backgroundColor: 'transparent' },
  duplicateBadge: { position: 'absolute', left: '36%', right: '36%', top: '42%' },
  scissorBlade: { position: 'absolute', top: '8%', left: '50%', width: '42%' },
  clipboardBody: { position: 'absolute', left: '18%', top: '18%', width: '64%', height: '74%', backgroundColor: 'transparent' },
  clipboardClip: { position: 'absolute', left: '38%', top: '8%', width: '24%', height: '16%', backgroundColor: 'transparent' },
});
