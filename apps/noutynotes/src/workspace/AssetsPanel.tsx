import {
  addAssetToBoard, assetKind, assetsOf, buildAssetCatalog, deleteUnusedAssets, fold, importAssetImage, inspectImage, replaceAsset,
} from '@noutynotes/application';
import type { AssetEntry, AssetKind, WorkspaceStorageResult } from '@noutynotes/application';
import type { AssetRef, CardId, Workspace } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';

import { Dialog } from '../components/Dialog';
import { ActionButton, TextField } from '../components/controls';
import { pickImageFile, supportsImageImport } from '../session/imageFiles';
import { useWorkspaceSession } from '../session/WorkspaceSession';
import { dataUri } from './dataUri';
import type { RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: string, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;
type Tab = 'all' | AssetKind;

interface AssetsPanelProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly run: Run;
  /** Zona visible y tablero actual: «Añadir al tablero» coloca la tarjeta donde se está mirando. */
  readonly placement: () => { readonly boardId?: Workspace['boards'][number]['id']; readonly near?: { x: number; y: number; columns: number }; readonly createdAt?: string };
  readonly onAdded: (cardId: CardId) => void;
  readonly onGo: (cardId: CardId) => void;
  readonly onClose: () => void;
}

const tabs: readonly { tab: Tab; label: string }[] = [
  { tab: 'all', label: 'Todos' }, { tab: 'image', label: 'Imágenes' }, { tab: 'document', label: 'Documentos' }, { tab: 'audio', label: 'Audio' }, { tab: 'other', label: 'Otros' },
];
const kindLabel: Readonly<Record<AssetKind, string>> = { image: 'Imagen', document: 'Documento', audio: 'Audio', other: 'Otro' };
const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Biblioteca de assets del proyecto (ADR 0022): el catálogo sale de los archivos bajo assets/ y de las
 * tarjetas que los usan. Importar, añadir al tablero sin copiar, reemplazar en todas las referencias y
 * eliminar solo lo que nada usa.
 */
export function AssetsPanel({ visible, compact, workspace, run, placement, onAdded, onGo, onClose }: AssetsPanelProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const { storage } = useWorkspaceSession();
  const [listed, setListed] = useState<readonly string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState<Tab>('all');
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [query, setQuery] = useState('');
  // Cuadrícula en escritorio y lista en móvil, salvo que la persona elija otra vista.
  const [gridChoice, setGridChoice] = useState<boolean | null>(null);
  const grid = gridChoice ?? !compact;
  const [selected, setSelected] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  const [bytes, setBytes] = useState<ReadonlyMap<string, number>>(new Map());
  const [confirm, setConfirm] = useState<'one' | 'unused' | null>(null);
  const [copied, setCopied] = useState(false);

  // Al abrir (y tras cada cambio), se lista la carpeta assets/ y se leen las miniaturas de las imágenes.
  useEffect(() => {
    if (!visible) return undefined;
    const assets = assetsOf(storage);
    if (!assets) return undefined;
    let active = true;
    void (async () => {
      const result = await assets.listAssets(workspace.id);
      if (!active) return;
      if (!result.ok) {
        setProblem(result.issues[0]?.message ?? 'No se pudo listar la carpeta assets.');
        return;
      }
      setProblem(null);
      setListed(result.value);
      const nextThumbs = new Map<string, string>();
      const nextBytes = new Map<string, number>();
      for (const ref of result.value) {
        if (assetKind(ref) !== 'image') continue;
        const read = await assets.readAsset(workspace.id, ref as AssetRef);
        if (!read.ok) continue;
        nextBytes.set(ref, read.value.length);
        const kind = inspectImage(read.value);
        if (kind.ok) nextThumbs.set(ref, dataUri(kind.value.mimeType, read.value));
      }
      if (active) {
        setThumbs(nextThumbs);
        setBytes(nextBytes);
      }
    })();
    return () => { active = false; };
  }, [visible, storage, workspace.id, refresh]);

  // Tamaño de un asset que no es imagen: se lee al seleccionarlo.
  useEffect(() => {
    if (!selected || bytes.has(selected)) return undefined;
    const assets = assetsOf(storage);
    if (!assets) return undefined;
    let active = true;
    void assets.readAsset(workspace.id, selected as AssetRef).then((read) => {
      if (active && read.ok) setBytes((current) => new Map(current).set(selected, read.value.length));
    });
    return () => { active = false; };
  }, [selected, bytes, storage, workspace.id]);

  const assets = assetsOf(storage);
  const catalog = buildAssetCatalog(workspace, listed ?? []);
  const counts = new Map<Tab, number>(tabs.map(({ tab: key }) => [key, key === 'all' ? catalog.length : catalog.filter((entry) => entry.kind === key).length]));
  const unused = catalog.filter((entry) => entry.unused);
  const text = fold(query.trim());
  const shown = catalog.filter((entry) => (tab === 'all' || entry.kind === tab) && (!unusedOnly || entry.unused) && (text === '' || fold(entry.name).includes(text)));
  const current = catalog.find((entry) => entry.ref === selected) ?? null;

  const close = () => {
    setConfirm(null);
    setSelected(null);
    onClose();
  };
  const reload = () => setRefresh((value) => value + 1);
  const pick = async () => {
    if (!supportsImageImport()) {
      setProblem('Este entorno no permite elegir imágenes.');
      return null;
    }
    try {
      return await pickImageFile();
    } catch {
      setProblem('No se pudo leer la imagen elegida. Comprueba el permiso y vuelve a intentarlo.');
      return null;
    }
  };
  const importImage = async () => {
    if (!assets) return;
    const file = await pick();
    if (!file) return;
    const result = await run((store, id) => importAssetImage(store, assets, id, { bytes: file.bytes, fileName: file.name }), `Imagen «${file.name}» añadida a la biblioteca. Guardado en memoria.`);
    if (result.ok) {
      setSelected(result.value);
      reload();
    }
  };
  const replace = async (entry: AssetEntry) => {
    if (!assets) return;
    const file = await pick();
    if (!file) return;
    const result = await run((store, id) => replaceAsset(store, assets, id, { from: entry.ref, bytes: file.bytes, fileName: file.name }),
      `«${entry.name}» reemplazado por «${file.name}» en ${plural(entry.usedBy.length, 'tarjeta', 'tarjetas')}; el archivo anterior queda sin usar. Guardado en memoria.`);
    if (result.ok) {
      setSelected(result.value);
      reload();
    }
  };
  const addToBoard = async (entry: AssetEntry) => {
    const where = placement();
    const result = await run((store, id) => addAssetToBoard(store, id, { ref: entry.ref, ...where }), `«${entry.name}» añadido al tablero sin copiar el archivo. Guardado en memoria.`);
    if (result.ok) {
      close();
      onAdded(result.value);
    }
  };
  const remove = async (refs: readonly string[]) => {
    if (!assets) return;
    const result = await run((store, id) => deleteUnusedAssets(store, assets, id, refs), `${plural(refs.length, 'archivo sin usar eliminado', 'archivos sin usar eliminados')}. Guardado en memoria.`, { history: 'clear' });
    setConfirm(null);
    if (result.ok) {
      if (result.value.failed.length > 0) setProblem(`No se pudo borrar: ${result.value.failed.join(', ')}.`);
      setSelected(null);
      reload();
    }
  };
  const copy = async (ref: string) => {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
    } catch {
      setProblem('El navegador no permitió copiar. Selecciona la ruta y cópiala a mano.');
    }
  };

  return (
    <Dialog visible={visible} title="Assets" compact={compact} onClose={close} testID="assets-panel">
      {!assets ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Este almacenamiento no guarda archivos.</Text>
      ) : (
        <>
          <View style={styles.row}>
            <ActionButton label="Importar imagen" tone="primary" accessibilityLabel="Importar una imagen a la biblioteca" onPress={() => void importImage()} />
            <ActionButton label={grid ? 'Ver lista' : 'Ver cuadrícula'} accessibilityLabel={grid ? 'Ver como lista' : 'Ver como cuadrícula'} onPress={() => setGridChoice(!grid)} />
          </View>
          <View style={styles.row} accessibilityLabel="Tipos de archivo">
            {tabs.map(({ tab: key, label }) => (
              <ActionButton key={key} label={`${label} · ${counts.get(key) ?? 0}`} pressed={tab === key}
                accessibilityLabel={`${label} (${counts.get(key) ?? 0})`} onPress={() => setTab(key)} />
            ))}
            <ActionButton label={`Sin usar · ${unused.length}`} pressed={unusedOnly} accessibilityLabel={`Solo sin usar (${unused.length})`} onPress={() => setUnusedOnly((value) => !value)} />
          </View>
          <TextField label="Buscar por nombre" value={query} onChangeText={setQuery} placeholder="nombre del archivo" testID="assets-search" />
          {problem ? <Text testID="assets-problem" accessibilityLiveRegion="assertive" style={[styles.hint, { color: colors.danger }]}>{problem}</Text> : null}
          {unused.length > 0 ? (
            confirm === 'unused' ? (
              <View testID="assets-confirm-unused" style={[styles.confirm, { borderColor: colors.danger }]}>
                <Text style={[styles.body, { color: colors.textPrimary }]}>{`¿Eliminar ${plural(unused.length, 'archivo sin usar', 'archivos sin usar')}? No se puede deshacer. Ninguna tarjeta, ni de la Papelera, los usa.`}</Text>
                <View style={styles.row}>
                  <ActionButton label="Eliminar" tone="primary" accessibilityLabel={`Confirmar eliminar ${plural(unused.length, 'archivo sin usar', 'archivos sin usar')}`} onPress={() => void remove(unused.map((entry) => entry.ref))} />
                  <ActionButton label="Cancelar" accessibilityLabel="Cancelar la eliminación" onPress={() => setConfirm(null)} />
                </View>
              </View>
            ) : <ActionButton label={`Eliminar los sin usar (${unused.length})`} onPress={() => setConfirm('unused')} />
          ) : null}

          <Text testID="assets-count" accessibilityLiveRegion="polite" style={[styles.section, { color: colors.textSecondary }]}>
            {listed === null ? 'LEYENDO…' : plural(shown.length, 'ARCHIVO', 'ARCHIVOS')}
          </Text>
          {listed !== null && catalog.length === 0 ? (
            <Text testID="assets-empty" style={[styles.hint, { color: colors.textSecondary }]}>Este proyecto aún no tiene archivos. Importa una imagen o añádela a una nota.</Text>
          ) : null}
          {/* El detalle va encima de la lista: con muchos archivos no hay que bajar hasta el final. */}
          {current ? (
            <View testID="asset-detail" style={[styles.detail, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text accessibilityRole="header" style={[styles.name, { color: colors.textPrimary }]}>{current.name}</Text>
              {thumbs.get(current.ref) ? (
                <Image accessibilityRole="image" accessibilityLabel={`Vista previa de ${current.name}`} source={{ uri: thumbs.get(current.ref) }} resizeMode="contain" style={styles.preview} />
              ) : null}
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {`${kindLabel[current.kind].toUpperCase()}${bytes.has(current.ref) ? ` · ${size(bytes.get(current.ref) ?? 0)}` : ''}${current.missing ? ' · NO ESTÁ EN LA CARPETA' : ''}`}
              </Text>
              <Text selectable testID="asset-path" style={[styles.path, { color: colors.textPrimary, borderColor: colors.gridLine }]}>{current.ref}</Text>
              <View style={styles.row}>
                {Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard ? (
                  <ActionButton label={copied ? 'Ruta copiada' : 'Copiar ruta'} accessibilityLabel={`Copiar la ruta ${current.ref}`} onPress={() => void copy(current.ref)} />
                ) : <Text style={[styles.hint, { color: colors.textSecondary }]}>Mantén pulsada la ruta para copiarla.</Text>}
                {current.kind === 'image' && !current.missing ? (
                  <>
                    <ActionButton label="Añadir al tablero" accessibilityLabel={`Añadir ${current.name} al tablero`} onPress={() => void addToBoard(current)} />
                    <ActionButton label="Reemplazar" accessibilityLabel={`Reemplazar ${current.name}`} onPress={() => void replace(current)} />
                  </>
                ) : null}
                {current.unused ? <ActionButton label="Eliminar" accessibilityLabel={`Eliminar ${current.name}`} onPress={() => setConfirm('one')} /> : null}
              </View>
              {confirm === 'one' ? (
                <View testID="assets-confirm-one" style={[styles.confirm, { borderColor: colors.danger }]}>
                  <Text style={[styles.body, { color: colors.textPrimary }]}>{`¿Eliminar «${current.name}»? No se puede deshacer. Ninguna tarjeta lo usa.`}</Text>
                  <View style={styles.row}>
                    <ActionButton label="Eliminar" tone="primary" accessibilityLabel={`Confirmar eliminar ${current.name}`} onPress={() => void remove([current.ref])} />
                    <ActionButton label="Cancelar" accessibilityLabel="Cancelar la eliminación" onPress={() => setConfirm(null)} />
                  </View>
                </View>
              ) : null}
              <Text style={[styles.section, { color: colors.textSecondary }]}>USADO EN</Text>
              {current.usedBy.length === 0 ? (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>Ninguna tarjeta lo usa. Puedes eliminarlo o añadirlo al tablero.</Text>
              ) : current.usedBy.map((use) => (
                <View key={use.cardId} style={styles.useRow}>
                  <Text style={[styles.body, styles.useText, { color: colors.textPrimary }]}>
                    {`${use.title} · ${use.inTrash ? 'en la Papelera' : use.inArchive ? 'en el Archivo' : use.boards.map((board) => board.title).join(', ') || 'sin tablero'}`}
                  </Text>
                  {use.inTrash || use.inArchive ? null : <ActionButton label="Ir" accessibilityLabel={`Ir a ${use.title}`} onPress={() => { close(); onGo(use.cardId); }} />}
                </View>
              ))}
              {current.usedBy.length > 0 ? (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>Para eliminarlo, quítalo antes de esas tarjetas. Reemplazar cambia todas a la vez y deja el archivo anterior sin usar.</Text>
              ) : null}
            </View>
          ) : null}
          <View style={grid ? styles.grid : styles.list}>
            {shown.map((entry) => (
              <View key={entry.ref} testID={`asset-${entry.name}`} style={[grid ? styles.tile : styles.line, { borderColor: entry.ref === selected ? colors.selection : colors.border, backgroundColor: colors.surface }]}>
                {thumbs.get(entry.ref) ? (
                  <Image accessibilityIgnoresInvertColors source={{ uri: thumbs.get(entry.ref) }} resizeMode="cover" style={grid ? styles.tileThumb : styles.lineThumb} />
                ) : (
                  <View style={[grid ? styles.tileThumb : styles.lineThumb, styles.placeholder, { backgroundColor: colors.background }]}>
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>{entry.missing ? 'FALTA' : kindLabel[entry.kind].toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.info}>
                  <Text numberOfLines={2} style={[styles.name, { color: colors.textPrimary }]}>{entry.name}</Text>
                  <Text numberOfLines={1} style={[styles.meta, { color: entry.missing ? colors.danger : colors.textSecondary }]}>
                    {entry.missing ? 'NO ESTÁ EN LA CARPETA' : entry.unused ? 'SIN USAR' : `USADO EN ${entry.usedBy.length}`}
                  </Text>
                  <ActionButton label={entry.ref === selected ? 'Viendo' : 'Ver'} pressed={entry.ref === selected} accessibilityLabel={`Ver ${entry.name}`}
                    onPress={() => { setSelected(entry.ref); setConfirm(null); setCopied(false); }} />
                </View>
              </View>
            ))}
          </View>

        </>
      )}
    </Dialog>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  hint: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 14, lineHeight: 20 },
  section: { fontFamily: mono, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 8 },
  confirm: { borderWidth: 2, padding: 10, gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { gap: 6 },
  tile: { width: 150, borderWidth: 2, padding: 6, gap: 6 },
  line: { flexDirection: 'row', borderWidth: 2, padding: 6, gap: 8, alignItems: 'center' },
  tileThumb: { width: '100%', height: 90 },
  lineThumb: { width: 56, height: 56 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 15, fontWeight: '800' },
  meta: { fontFamily: mono, fontSize: 11, fontWeight: '700' },
  detail: { borderWidth: 2, padding: 10, gap: 8 },
  preview: { width: '100%', height: 180 },
  path: { fontFamily: mono, fontSize: 13, borderWidth: 1, padding: 8 },
  useRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  useText: { flex: 1 },
});
