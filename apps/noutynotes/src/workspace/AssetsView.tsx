import {
  addAssetToBoard, assetKind, assetsOf, buildAssetCatalog, deleteUnusedAssets, fold, importAssetImage, importLibraryFile, importLibraryFont, inspectFont, inspectImage, replaceAsset,
} from '@noutynotes/application';
import type { AssetEntry, AssetKind, WorkspaceStorageResult } from '@noutynotes/application';
import type { AssetRef, CardId, Workspace } from '@noutynotes/domain';
import type { Locale } from '@noutynotes/ui';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { t } from '../i18n';
import { activateCustomFont, supportsCustomFont } from '../session/customFont';
import { pickLibraryFile, supportsFileImport } from '../session/fileImport';
import { pickFontFile, supportsFontImport } from '../session/fontImport';
import { fetchGoogleFont, supportsGoogleFonts } from '../session/googleFonts';
import { pickImageFile, supportsImageImport } from '../session/imageFiles';
import { openAssetFile, supportsOpenAsset } from '../session/openAsset';
import { useWorkspaceSession } from '../session/WorkspaceSession';
import type { ViewPreferences } from './canvas/preferences';
import { dataUri } from './dataUri';
import { useEscapeBack } from './useEscapeBack';
import type { RunOptions, WorkspaceAction } from './useWorkspaceEditor';

type Run = <T>(action: WorkspaceAction<T>, success: string, options?: RunOptions) => Promise<WorkspaceStorageResult<T>>;
type Tab = 'all' | AssetKind;

interface AssetsViewProps {
  readonly active: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly run: Run;
  /** Zona visible y tablero actual: «Añadir al tablero» coloca la tarjeta donde se está mirando. */
  readonly placement: () => { readonly boardId?: Workspace['boards'][number]['id']; readonly near?: { x: number; y: number; columns: number }; readonly createdAt?: string };
  readonly onAdded: (cardId: CardId) => void;
  readonly onGo: (cardId: CardId) => void;
  readonly onBack: () => void;
  /** Tipografía de las notas (ADR 0041): «Usar en las notas» activa la fuente y guarda la preferencia. */
  readonly preferences: ViewPreferences;
  readonly onPreferencesChange: (next: ViewPreferences) => void;
}

const tabKeys: readonly { tab: Tab; labelKey: 'assets.tab.all' | 'assets.tab.image' | 'assets.tab.document' | 'assets.tab.audio' | 'assets.tab.font' | 'assets.tab.other' }[] = [
  { tab: 'all', labelKey: 'assets.tab.all' }, { tab: 'image', labelKey: 'assets.tab.image' }, { tab: 'document', labelKey: 'assets.tab.document' }, { tab: 'audio', labelKey: 'assets.tab.audio' }, { tab: 'font', labelKey: 'assets.tab.font' }, { tab: 'other', labelKey: 'assets.tab.other' },
];
const kindLabelKey: Readonly<Record<AssetKind, 'assets.kind.image' | 'assets.kind.document' | 'assets.kind.audio' | 'assets.kind.font' | 'assets.kind.other'>> = {
  image: 'assets.kind.image', document: 'assets.kind.document', audio: 'assets.kind.audio', font: 'assets.kind.font', other: 'assets.kind.other',
};
type PluralUnit = 'unusedDeleted' | 'unused' | 'fileUpper' | 'card';
const unit = (base: PluralUnit, count: number, locale: Locale) =>
  t(count === 1 ? `unit.${base}.one` : `unit.${base}.many`, locale, { count: String(count) });
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Biblioteca de assets del proyecto (ADR 0022, ADR 0036): vista de trabajo real a pantalla completa,
 * no un diálogo estrecho. El catálogo sale de los archivos bajo assets/ y de las tarjetas que los usan.
 * Importar, añadir al tablero sin copiar, reemplazar en todas las referencias y eliminar solo lo que
 * nada usa.
 */
export function AssetsView({ active, compact, workspace, run, placement, onAdded, onGo, onBack, preferences, onPreferencesChange }: AssetsViewProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const kindLabel: Readonly<Record<AssetKind, string>> = {
    image: t(kindLabelKey.image, locale), document: t(kindLabelKey.document, locale), audio: t(kindLabelKey.audio, locale), font: t(kindLabelKey.font, locale), other: t(kindLabelKey.other, locale),
  };
  const tabs: readonly { tab: Tab; label: string }[] = tabKeys.map(({ tab, labelKey }) => ({ tab, label: t(labelKey, locale) }));
  useEscapeBack(active, onBack);
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
  const [fontDraft, setFontDraft] = useState<{ readonly bytes: Uint8Array; readonly name: string } | null>(null);
  const [fontConsent, setFontConsent] = useState(false);
  const [licenseNote, setLicenseNote] = useState('');
  const [googleSearchOpen, setGoogleSearchOpen] = useState(false);
  const [googleQuery, setGoogleQuery] = useState('');
  const [googleSearching, setGoogleSearching] = useState(false);

  // Al entrar (y tras cada cambio), se lista la carpeta assets/ y se leen las miniaturas de las imágenes.
  useEffect(() => {
    const assets = assetsOf(storage);
    if (!assets) return undefined;
    let active = true;
    void (async () => {
      const result = await assets.listAssets(workspace.id);
      if (!active) return;
      if (!result.ok) {
        setProblem(result.issues[0]?.message ?? t('assets.error.list', locale));
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
  }, [storage, workspace.id, refresh, locale]);

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

  const reload = () => setRefresh((value) => value + 1);
  const pick = async () => {
    if (!supportsImageImport()) {
      setProblem(t('assets.error.noImagePicker', locale));
      return null;
    }
    try {
      return await pickImageFile();
    } catch {
      setProblem(t('assets.error.imageReadFailed', locale));
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
  const importFile = async () => {
    if (!assets) return;
    if (!supportsFileImport()) {
      setProblem(t('assets.error.noFilePicker', locale));
      return;
    }
    let file;
    try {
      file = await pickLibraryFile();
    } catch {
      setProblem(t('assets.error.fileReadFailed', locale));
      return;
    }
    if (!file) return;
    const result = await run((store, id) => importLibraryFile(store, assets, id, { bytes: file.bytes, fileName: file.name }), `«${file.name}» añadido a la biblioteca. Guardado en memoria.`);
    if (result.ok) {
      setSelected(result.value);
      reload();
    }
  };
  const pickFont = async () => {
    if (!supportsFontImport()) {
      setProblem(t('assets.error.noFontPicker', locale));
      return;
    }
    let file;
    try {
      file = await pickFontFile();
    } catch {
      setProblem(t('assets.error.fontReadFailed', locale));
      return;
    }
    if (!file) return;
    // Firma binaria antes de pedir consentimiento (ADR 0041): no tiene sentido pedir licencia de algo
    // que ni siquiera es una fuente TTF/OTF.
    const kind = inspectFont(file.bytes);
    if (!kind.ok) {
      setProblem(kind.issues[0]?.message ?? t('assets.error.fontReadFailed', locale));
      return;
    }
    setProblem(null);
    setFontDraft(file);
  };
  const cancelFontImport = () => {
    setFontDraft(null);
    setFontConsent(false);
    setLicenseNote('');
  };
  const searchGoogleFont = async () => {
    const name = googleQuery.trim();
    if (name === '') {
      setProblem(t('assets.google.error.empty', locale));
      return;
    }
    setGoogleSearching(true);
    const outcome = await fetchGoogleFont(name);
    setGoogleSearching(false);
    if (!outcome.ok) {
      setProblem(t(`assets.google.error.${outcome.reason}`, locale, { name }));
      return;
    }
    const kind = inspectFont(outcome.value.bytes);
    if (!kind.ok) {
      setProblem(kind.issues[0]?.message ?? t('assets.google.error.parse', locale));
      return;
    }
    setProblem(null);
    setGoogleSearchOpen(false);
    setGoogleQuery('');
    setFontDraft({ bytes: outcome.value.bytes, name: outcome.value.fileName });
    setLicenseNote(t('assets.google.license.note', locale, { name }));
  };
  const confirmFontImport = async () => {
    if (!assets || !fontDraft || !fontConsent) return;
    const draft = fontDraft;
    const note = licenseNote;
    const result = await run((store, id) => importLibraryFont(store, assets, id, { bytes: draft.bytes, fileName: draft.name, licenseNote: note }),
      `«${draft.name}» añadida a la biblioteca. Guardado en memoria.`);
    cancelFontImport();
    if (result.ok) {
      setSelected(result.value.ref);
      reload();
    }
  };
  const applyFontToNotes = async (entry: AssetEntry) => {
    if (!assets) return;
    const read = await assets.readAsset(workspace.id, entry.ref as AssetRef);
    if (!read.ok) {
      setProblem(read.issues[0]?.message ?? t('assets.error.readFailed', locale));
      return;
    }
    const activated = await activateCustomFont(entry.ref, read.value);
    if (!activated) {
      setProblem(t('assets.font.activateFailed', locale));
      return;
    }
    onPreferencesChange({ ...preferences, noteFont: 'custom', customFontRef: entry.ref });
  };
  const openFile = async (entry: AssetEntry) => {
    if (!assets) return;
    const read = await assets.readAsset(workspace.id, entry.ref as AssetRef);
    if (!read.ok) {
      setProblem(read.issues[0]?.message ?? t('assets.error.readFailed', locale));
      return;
    }
    openAssetFile(entry.name, read.value);
  };
  const replace = async (entry: AssetEntry) => {
    if (!assets) return;
    const file = await pick();
    if (!file) return;
    const cardsEs = entry.usedBy.length === 1 ? '1 tarjeta' : `${entry.usedBy.length} tarjetas`;
    const result = await run((store, id) => replaceAsset(store, assets, id, { from: entry.ref, bytes: file.bytes, fileName: file.name }),
      `«${entry.name}» reemplazado por «${file.name}» en ${cardsEs}; el archivo anterior queda sin usar. Guardado en memoria.`);
    if (result.ok) {
      setSelected(result.value);
      reload();
    }
  };
  const addToBoard = async (entry: AssetEntry) => {
    const where = placement();
    const result = await run((store, id) => addAssetToBoard(store, id, { ref: entry.ref, ...where }), `«${entry.name}» añadido al tablero sin copiar el archivo. Guardado en memoria.`);
    if (result.ok) {
      onBack();
      onAdded(result.value);
    }
  };
  const remove = async (refs: readonly string[]) => {
    if (!assets) return;
    const deletedEs = refs.length === 1 ? '1 archivo sin usar eliminado' : `${refs.length} archivos sin usar eliminados`;
    const result = await run((store, id) => deleteUnusedAssets(store, assets, id, refs), `${deletedEs}. Guardado en memoria.`, { history: 'clear' });
    setConfirm(null);
    if (result.ok) {
      if (result.value.failed.length > 0) setProblem(t('assets.error.deleteFailed', locale, { files: result.value.failed.join(', ') }));
      setSelected(null);
      reload();
    }
  };
  const copy = async (ref: string) => {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
    } catch {
      setProblem(t('assets.error.copyFailed', locale));
    }
  };

  const detail = current ? (
    <View testID="asset-detail" style={[styles.detail, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text accessibilityRole="header" style={[styles.name, { color: colors.textPrimary }]}>{current.name}</Text>
      {thumbs.get(current.ref) ? (
        <Image accessibilityRole="image" accessibilityLabel={t('assets.preview.accessibilityLabel', locale, { name: current.name })} source={{ uri: thumbs.get(current.ref) }} resizeMode="contain" style={styles.preview} />
      ) : null}
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {`${kindLabel[current.kind].toUpperCase()}${bytes.has(current.ref) ? ` · ${size(bytes.get(current.ref) ?? 0)}` : ''}${current.missing ? t('assets.missingSuffix', locale) : ''}`}
      </Text>
      <Text selectable testID="asset-path" style={[styles.path, { color: colors.textPrimary, borderColor: colors.gridLine }]}>{current.ref}</Text>
      <View style={styles.row}>
        {Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard ? (
          <ActionButton label={copied ? t('assets.copyPath.copied', locale) : t('assets.copyPath', locale)} accessibilityLabel={t('assets.copyPath.accessibilityLabel', locale, { ref: current.ref })} onPress={() => void copy(current.ref)} />
        ) : <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('assets.copyPath.hint', locale)}</Text>}
        {current.kind === 'image' && !current.missing ? (
          <>
            <ActionButton label={t('assets.addToBoard', locale)} accessibilityLabel={t('assets.addToBoard.accessibilityLabel', locale, { name: current.name })} onPress={() => void addToBoard(current)} />
            <ActionButton label={t('assets.replace', locale)} accessibilityLabel={t('assets.replace.accessibilityLabel', locale, { name: current.name })} onPress={() => void replace(current)} />
          </>
        ) : null}
        {(current.kind === 'document' || current.kind === 'audio') && !current.missing && supportsOpenAsset() ? (
          <ActionButton label={t('assets.open', locale)} accessibilityLabel={t('assets.open.accessibilityLabel', locale, { name: current.name })} onPress={() => void openFile(current)} />
        ) : null}
        {current.kind === 'font' && !current.missing ? (
          preferences.noteFont === 'custom' && preferences.customFontRef === current.ref ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('assets.font.active', locale)}</Text>
          ) : (
            <ActionButton label={t('assets.font.useInNotes', locale)} accessibilityLabel={t('assets.font.useInNotes.accessibilityLabel', locale, { name: current.name })} onPress={() => void applyFontToNotes(current)} />
          )
        ) : null}
        {current.unused ? <ActionButton label={t('assets.delete', locale)} accessibilityLabel={t('assets.delete.accessibilityLabel', locale, { name: current.name })} onPress={() => setConfirm('one')} /> : null}
      </View>
      {confirm === 'one' ? (
        <View testID="assets-confirm-one" style={[styles.confirm, { borderColor: colors.danger }]}>
          <Text style={[styles.body, { color: colors.textPrimary }]}>{t('assets.confirm.one.body', locale, { name: current.name })}</Text>
          <View style={styles.row}>
            <ActionButton label={t('assets.delete', locale)} tone="primary" accessibilityLabel={t('assets.confirm.accessibilityLabel', locale, { name: current.name })} onPress={() => void remove([current.ref])} />
            <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('trash.cancel.accessibilityLabel', locale)} onPress={() => setConfirm(null)} />
          </View>
        </View>
      ) : null}
      <Text style={[styles.section, { color: colors.textSecondary }]}>{t('assets.section.usedBy', locale)}</Text>
      {current.usedBy.length === 0 ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('assets.usedBy.empty', locale)}</Text>
      ) : current.usedBy.map((use) => (
        <View key={use.cardId} style={styles.useRow}>
          <Text style={[styles.body, styles.useText, { color: colors.textPrimary }]}>
            {`${use.title} · ${use.inTrash ? t('assets.use.inTrash', locale) : use.inArchive ? t('assets.use.inArchive', locale) : use.boards.map((board) => board.title).join(', ') || t('search.noBoard', locale)}`}
          </Text>
          {use.inTrash || use.inArchive ? null : <ActionButton label={t('search.go', locale)} accessibilityLabel={t('search.go.accessibilityLabel', locale, { title: use.title })} onPress={() => { onBack(); onGo(use.cardId); }} />}
        </View>
      ))}
      {current.usedBy.length > 0 ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('assets.usedBy.hint', locale)}</Text>
      ) : null}
    </View>
  ) : null;

  const list = (
    <View style={grid ? styles.grid : styles.list}>
      {shown.map((entry) => (
        <View key={entry.ref} testID={`asset-${entry.name}`} style={[grid ? styles.tile : styles.line, { borderColor: entry.ref === selected ? colors.selection : colors.border, backgroundColor: colors.surface }]}>
          {thumbs.get(entry.ref) ? (
            <Image accessibilityIgnoresInvertColors source={{ uri: thumbs.get(entry.ref) }} resizeMode="cover" style={grid ? styles.tileThumb : styles.lineThumb} />
          ) : (
            <View style={[grid ? styles.tileThumb : styles.lineThumb, styles.placeholder, { backgroundColor: colors.background }]}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{entry.missing ? t('assets.missingBadge', locale) : kindLabel[entry.kind].toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.info}>
            <Text numberOfLines={2} style={[styles.name, { color: colors.textPrimary }]}>{entry.name}</Text>
            <Text numberOfLines={1} style={[styles.meta, { color: entry.missing ? colors.danger : colors.textSecondary }]}>
              {entry.missing ? t('assets.item.missing', locale) : entry.unused ? t('assets.item.unused', locale) : t('assets.item.usedIn', locale, { count: String(entry.usedBy.length) })}
            </Text>
            <ActionButton label={entry.ref === selected ? t('assets.viewing', locale) : t('assets.view', locale)} pressed={entry.ref === selected} accessibilityLabel={t('assets.view.accessibilityLabel', locale, { name: entry.name })}
              onPress={() => { setSelected(entry.ref); setConfirm(null); setCopied(false); }} />
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <View testID="assets-view" style={styles.screen}>
      <View style={[styles.header, { borderColor: colors.gridLine }]}>
        <ActionButton label="←" accessibilityLabel={t('workview.back', locale)} onPress={onBack} />
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>{t('nav.assets', locale)}</Text>
      </View>
      {!assets ? (
        <Text style={[styles.hint, styles.pad, { color: colors.textSecondary }]}>{t('assets.unsupported', locale)}</Text>
      ) : (
        <>
          {/* Barra contextual: propia de esta vista, no la del lienzo (ADR 0036). */}
          <View style={[styles.toolbar, { borderColor: colors.gridLine }]}>
            <ActionButton label={t('assets.import.image', locale)} tone="primary" accessibilityLabel={t('assets.import.image.accessibilityLabel', locale)} onPress={() => void importImage()} />
            {supportsFileImport() ? <ActionButton label={t('assets.import.file', locale)} accessibilityLabel={t('assets.import.file.accessibilityLabel', locale)} onPress={() => void importFile()} /> : null}
            {supportsFontImport() ? <ActionButton label={t('assets.import.font', locale)} accessibilityLabel={t('assets.import.font.accessibilityLabel', locale)} onPress={() => void pickFont()} /> : null}
            {/* Solo donde ya se puede activar una fuente (ADR 0042): no tiene sentido descargar lo que no se puede usar todavía. */}
            {supportsGoogleFonts() && supportsCustomFont() ? (
              <ActionButton label={t('assets.google.button', locale)} accessibilityLabel={t('assets.google.button.accessibilityLabel', locale)} onPress={() => setGoogleSearchOpen(true)} />
            ) : null}
            <ActionButton label={grid ? t('assets.view.list', locale) : t('assets.view.grid', locale)} accessibilityLabel={grid ? t('assets.view.list.accessibilityLabel', locale) : t('assets.view.grid.accessibilityLabel', locale)} onPress={() => setGridChoice(!grid)} />
            {tabs.map(({ tab: key, label }) => (
              <ActionButton key={key} label={`${label} · ${counts.get(key) ?? 0}`} pressed={tab === key}
                accessibilityLabel={t('assets.tab.accessibilityLabel', locale, { label, count: String(counts.get(key) ?? 0) })} onPress={() => setTab(key)} />
            ))}
            <ActionButton label={t('assets.tab.unused', locale, { count: String(unused.length) })} pressed={unusedOnly} accessibilityLabel={t('assets.tab.unused.accessibilityLabel', locale, { count: String(unused.length) })} onPress={() => setUnusedOnly((value) => !value)} />
          </View>
          <ScrollView contentContainerStyle={[styles.content, compact ? null : styles.contentWide]}>
            <View style={compact ? styles.column : styles.mainColumn}>
              <TextField label={t('assets.search.label', locale)} value={query} onChangeText={setQuery} placeholder={t('assets.search.placeholder', locale)} testID="assets-search" />
              {problem ? <Text testID="assets-problem" accessibilityLiveRegion="assertive" style={[styles.hint, { color: colors.danger }]}>{problem}</Text> : null}
              {googleSearchOpen ? (
                <View testID="assets-google-search" style={[styles.confirm, { borderColor: colors.border }]}>
                  <TextField label={t('assets.google.input.label', locale)} value={googleQuery} onChangeText={setGoogleQuery} placeholder={t('assets.google.input.placeholder', locale)}
                    onSubmitEditing={() => void searchGoogleFont()} testID="assets-google-input" />
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('assets.google.hint', locale)}</Text>
                  <View style={styles.row}>
                    <ActionButton label={googleSearching ? t('assets.google.searching', locale) : t('assets.google.search', locale)} tone="primary"
                      disabled={googleSearching} onPress={() => void searchGoogleFont()} />
                    <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('assets.google.cancel.accessibilityLabel', locale)} onPress={() => { setGoogleSearchOpen(false); setGoogleQuery(''); }} />
                  </View>
                </View>
              ) : null}
              {fontDraft ? (
                <View testID="assets-font-consent" style={[styles.confirm, { borderColor: colors.border }]}>
                  <Text style={[styles.body, { color: colors.textPrimary }]}>{t('assets.font.import.title', locale, { name: fontDraft.name })}</Text>
                  <ActionButton label={t('assets.font.consent', locale)} pressed={fontConsent} onPress={() => setFontConsent((value) => !value)} />
                  <TextField label={t('assets.font.license.label', locale)} value={licenseNote} onChangeText={setLicenseNote} placeholder={t('assets.font.license.placeholder', locale)} testID="assets-font-license-input" />
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('assets.font.license.hint', locale)}</Text>
                  <View style={styles.row}>
                    <ActionButton label={t('assets.font.import.confirm', locale)} tone="primary" disabled={!fontConsent} onPress={() => void confirmFontImport()} />
                    <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('assets.font.import.cancel.accessibilityLabel', locale)} onPress={cancelFontImport} />
                  </View>
                </View>
              ) : null}
              {unused.length > 0 ? (
                confirm === 'unused' ? (
                  <View testID="assets-confirm-unused" style={[styles.confirm, { borderColor: colors.danger }]}>
                    <Text style={[styles.body, { color: colors.textPrimary }]}>{t('assets.confirm.unused.body', locale, { count: unit('unused', unused.length, locale) })}</Text>
                    <View style={styles.row}>
                      <ActionButton label={t('assets.delete', locale)} tone="primary" accessibilityLabel={t('assets.confirm.unused.accessibilityLabel', locale, { count: unit('unused', unused.length, locale) })} onPress={() => void remove(unused.map((entry) => entry.ref))} />
                      <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('trash.cancel.accessibilityLabel', locale)} onPress={() => setConfirm(null)} />
                    </View>
                  </View>
                ) : <ActionButton label={t('assets.deleteUnused', locale, { count: String(unused.length) })} onPress={() => setConfirm('unused')} />
              ) : null}

              <Text testID="assets-count" accessibilityLiveRegion="polite" style={[styles.section, { color: colors.textSecondary }]}>
                {listed === null ? t('assets.loading', locale) : unit('fileUpper', shown.length, locale)}
              </Text>
              {listed !== null && catalog.length === 0 ? (
                <Text testID="assets-empty" style={[styles.hint, { color: colors.textSecondary }]}>{t('assets.empty', locale)}</Text>
              ) : null}
              {/* En móvil, el detalle va encima de la lista: con muchos archivos no hay que bajar hasta el final. */}
              {compact ? detail : null}
              {list}
            </View>
            {!compact ? <View style={styles.sideColumn}>{detail}</View> : null}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderBottomWidth: 2 },
  heading: { fontSize: 22, fontWeight: '900' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 12, borderBottomWidth: 1 },
  content: { padding: 16, gap: 16 },
  contentWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { gap: 8 },
  mainColumn: { flex: 1, gap: 8, minWidth: 0 },
  sideColumn: { width: 320, flexShrink: 0, gap: 8 },
  pad: { padding: 16 },
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
