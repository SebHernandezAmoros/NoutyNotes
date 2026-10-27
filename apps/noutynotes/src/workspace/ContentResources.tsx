import { assetsOf, buildAssetCatalog, importLibraryFile, inspectFont, inspectNotePdf, prepareNotePdf } from '@noutynotes/application';
import type { WorkspaceStorage } from '@noutynotes/application';
import type { AssetRef, Card, RichTextPdf, Workspace } from '@noutynotes/domain';
import { useLocale, useTheme } from '@noutynotes/ui';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import { activateCustomFont, customFontFamilyName, releaseCustomFonts, supportsCustomFont } from '../session/customFont';
import { pickLibraryFile } from '../session/fileImport';
import { noteFontFamily } from './fonts';
import { resolveImageResource } from './imageResources';
import { ImageViewer } from './ImageViewer';
import type { ImageViewerState } from './ImageViewer';

interface Resources {
  readonly canInsert: (cardId: string) => boolean;
  readonly pickPdf: () => Promise<RichTextPdf | null>;
  readonly openPdf: (block: RichTextPdf) => void;
  readonly pdfState: (ref: string) => 'available' | 'missing' | 'unknown';
  readonly openImage: (ref: string, label?: string) => void;
  readonly fontFor: (card: Card, inherited?: string) => string | undefined;
  readonly fontState: (ref: string) => string;
  readonly fontRefs: readonly string[];
}
const fallback: Resources = { canInsert: () => false, pickPdf: async () => null, openPdf: () => {}, pdfState: () => 'unknown', openImage: () => {}, fontFor: (_card, inherited) => inherited, fontState: () => 'unsupported', fontRefs: [] };
const Context = createContext<Resources>(fallback);
export const useContentResources = () => useContext(Context);

/** UI resource lifecycle only; no snapshot authority, deletion or second durable catalog. */
export function ContentResourcesProvider({ storage, workspace, inheritedFont, onOpenPdf, children }: {
  readonly storage: WorkspaceStorage; readonly workspace: Workspace | null;
  readonly inheritedFont?: string | undefined; readonly onOpenPdf: (ref: AssetRef, name: string) => void; readonly children: ReactNode;
}) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const colors = theme.colors;
  const assets = assetsOf(storage);
  const [disk, setDisk] = useState<{ id: string; refs: readonly string[] } | null>(null);
  const [fonts, setFonts] = useState<{ id: string; values: ReadonlyMap<string, { status: string; family?: string }> } | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [imageWorkspace, setImageWorkspace] = useState<string | null>(null);
  const [image, setImage] = useState<ImageViewerState | null>(null);
  useEffect(() => { const id = workspace?.id; return () => { if (id) releaseCustomFonts(id); }; }, [workspace?.id]);
  const pending = useRef<((block: RichTextPdf | null) => void) | null>(null);
  const imageRequest = useRef(0);
  useEffect(() => {
    let active = true;
    if (workspace && assets) {
      void assets.listAssets(workspace.id).then((result) => { if (active && result.ok) setDisk({ id: workspace.id, refs: result.value }); });
      const refs = [...new Set(workspace.cards.flatMap((card) => card.noteFont?.kind === 'asset' ? [card.noteFont.assetRef] : []))];
      void Promise.all(refs.map(async (ref) => {
        if (!supportsCustomFont()) return [ref, { status: 'unsupported' }] as const;
        const read = await assets.readAsset(workspace.id, ref);
        if (!read.ok) return [ref, { status: 'missing' }] as const;
        if (!inspectFont(read.value).ok) return [ref, { status: 'failed' }] as const;
        const ok = await activateCustomFont(ref, read.value, workspace.id);
        return [ref, ok ? { status: 'active', family: customFontFamilyName(ref, workspace.id) } : { status: 'failed' }] as const;
      })).then((values) => { if (active) setFonts({ id: workspace.id, values: new Map<string, { status: string; family?: string }>(values) }); });
    }
    return () => { active = false; };
  }, [assets, workspace]);
  useEffect(() => () => { pending.current?.(null); pending.current = null; imageRequest.current += 1; }, [workspace?.id]);
  const finish = (block: RichTextPdf | null) => { pending.current?.(block); pending.current = null; setPicker(null); };
  const selectPdf = async (ref: string, name: string) => {
    if (!assets || !workspace) return;
    const request = pending.current;
    const result = await prepareNotePdf(assets, workspace.id, ref, name);
    if (request !== pending.current) return;
    if (result.ok) finish(result.value); else setProblem(t('content.pdfRejected', locale));
  };
  const importPdf = async () => {
    if (!assets || !workspace) return;
    const request = pending.current;
    try {
      const file = await pickLibraryFile();
      if (!file || request !== pending.current) return;
      const valid = inspectNotePdf(file.bytes);
      if (!valid.ok) { setProblem(t('content.pdfRejected', locale)); return; }
      if (!/\.pdf$/i.test(file.name)) { setProblem(t('content.pdfOnly', locale)); return; }
      const result = await importLibraryFile(storage, assets, workspace.id, { bytes: file.bytes, fileName: file.name });
      if (request !== pending.current) return;
      if (result.ok) await selectPdf(result.value, file.name); else setProblem(t('content.pdfRejected', locale));
    } catch { setProblem(t('content.failed', locale)); }
  };
  const openImage = (ref: string, label = '') => {
    if (!workspace || !assets) return;
    setImageWorkspace(workspace.id);
    const request = ++imageRequest.current;
    setImage({ status: 'loading', label });
    void assets.listAssets(workspace.id).then(async (listed) => {
      if (!listed.ok) return { status: 'unavailable' as const, reason: 'unreadable' as const };
      return resolveImageResource(assets, workspace.id, ref as AssetRef, new Set(listed.value));
    }).then((resource) => {
      if (request !== imageRequest.current) return;
      setImage(resource.status === 'ready' ? { status: 'ready', uri: resource.uri, label } : { status: 'error', label });
    }).catch(() => { if (request === imageRequest.current) setImage({ status: 'error', label }); });
  };
  const currentDisk = disk && disk.id === workspace?.id ? disk.refs : null;
  const currentFonts = fonts && fonts.id === workspace?.id ? fonts.values : new Map<string, { status: string; family?: string }>();
  const value: Resources = {
    canInsert: (id) => Platform.OS === 'web' && !!workspace?.cards.some((card) => card.id === id && workspace.cardTypes.some((type) => type.id === card.typeId && type.base === 'note')),
    pickPdf: () => new Promise((resolve) => { pending.current?.(null); pending.current = resolve; setProblem(''); setPicker(workspace?.id ?? null); }),
    openPdf: (block) => onOpenPdf(block.assetRef, block.label ?? t('content.pdf', locale)),
    pdfState: (ref) => currentDisk === null ? 'unknown' : currentDisk.includes(ref) ? 'available' : 'missing',
    openImage,
    fontFor: (card, inherited) => card.noteFont?.kind === 'builtin' ? noteFontFamily(card.noteFont.family, Platform.OS)
      : card.noteFont?.kind === 'asset' ? currentFonts.get(card.noteFont.assetRef)?.family : inherited ?? inheritedFont,
    fontState: (ref) => currentFonts.get(ref)?.status ?? 'loading',
    fontRefs: (currentDisk ?? []).filter((ref) => /\.(ttf|otf|woff2)$/i.test(ref)),
  };
  const entries = workspace && currentDisk ? buildAssetCatalog(workspace, currentDisk).filter((entry) => /\.pdf$/i.test(entry.ref)) : [];
  return <Context.Provider value={value}>
    {children}
    <Dialog visible={!!picker && picker === workspace?.id} title={t('content.insertPdf', locale)} compact onClose={() => finish(null)} testID="note-pdf-picker">
      <Text style={{ color: colors.textPrimary }}>{t('content.pdfLimit', locale)}</Text>
      <Pressable accessibilityRole="button" onPress={() => void importPdf()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.textPrimary }}>{t('content.importPdf', locale)}</Text></Pressable>
      {entries.map((entry) => <Pressable key={entry.ref} accessibilityRole="button" disabled={entry.missing} onPress={() => void selectPdf(entry.ref, entry.name)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.textPrimary }}>{entry.name}{entry.missing ? ` · ${t('content.missing', locale)}` : ''}</Text></Pressable>)}
      {problem ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{problem}</Text> : null}
    </Dialog>
    <ImageViewer state={imageWorkspace === workspace?.id ? image : null} onClose={() => { imageRequest.current += 1; setImage(null); }} />
  </Context.Provider>;
}

export function PdfBlockView({ block, color }: { readonly block: RichTextPdf; readonly color?: string | undefined }) {
  const resources = useContentResources();
  const { locale } = useLocale();
  const { theme } = useTheme();
  if (Platform.OS !== 'web') return <Text>{block.label ?? t('content.pdf', locale)} - {t('content.pdfWebOnly', locale)}</Text>;
  return <View testID="note-pdf-block" style={{ height: 84, minHeight: 84, flexShrink: 0, padding: 4, borderWidth: 1, borderColor: theme.colors.border }}>
    <Pressable accessibilityRole="button" onPress={(event) => { event.stopPropagation(); resources.openPdf(block); }} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text numberOfLines={2} style={{ color: color ?? theme.colors.cardText }}>PDF · {block.label ?? t('content.pdf', locale)} · {t('content.open', locale)}</Text>
    </Pressable>
    <Text numberOfLines={1} style={{ color: color ?? theme.colors.cardText, opacity: 0.8 }}>{resources.pdfState(block.assetRef) === 'missing' ? t('content.missing', locale) : t('content.pdfLocal', locale)}</Text>
  </View>;
}
