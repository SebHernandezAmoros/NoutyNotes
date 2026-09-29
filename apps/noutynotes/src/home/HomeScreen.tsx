import { createEmptyWorkspaceNamed } from '@noutynotes/application';
import type { WorkspaceStorage, WorkspaceSummary } from '@noutynotes/application';
import { resolveLayoutMode, useLocale, useTheme, useWindowWidth } from '@noutynotes/ui';
import type { ThemePreference } from '@noutynotes/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { TextField } from '../components/controls';
import { useHydrated } from '../components/useHydrated';
import { t } from '../i18n';
import { describeFailure } from '../session/messages';
import { useWorkspaceSession, useWorkspaceStorage } from '../session/WorkspaceSession';
import { numberActions, singleFlight } from './actions';
import { TemplatePicker } from './TemplatePicker';

const themeOptions: { value: ThemePreference; labelKey: 'settings.theme.light' | 'settings.theme.dark' | 'settings.theme.system'; accessibilityLabelKey: 'home.theme.light.label' | 'home.theme.dark.label' | 'home.theme.system.label' }[] = [
  { value: 'light', labelKey: 'settings.theme.light', accessibilityLabelKey: 'home.theme.light.label' },
  { value: 'dark', labelKey: 'settings.theme.dark', accessibilityLabelKey: 'home.theme.dark.label' },
  { value: 'system', labelKey: 'settings.theme.system', accessibilityLabelKey: 'home.theme.system.label' },
];

/** Espacios guardados en la memoria de esta sesión; se vuelven a leer al regresar a la pantalla. */
function useSessionWorkspaces(): readonly WorkspaceSummary[] {
  const storage = useWorkspaceStorage();
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  useFocusEffect(useCallback(() => {
    let active = true;
    void storage.list().then((listed) => {
      if (active && listed.ok) setWorkspaces(listed.value);
    });
    return () => { active = false; };
  }, [storage]));
  return workspaces;
}

export function HomeScreen() {
  const { theme, preference, setPreference } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const compact = resolveLayoutMode(useWindowWidth()) === 'compact';
  const [focusedTheme, setFocusedTheme] = useState<ThemePreference | null>(null);
  const storage = useWorkspaceStorage();
  const session = useWorkspaceSession();
  const workspaces = useSessionWorkspaces();
  const [draftName, setDraftName] = useState('');
  // En el HTML estático el campo no admite escritura: el render del cliente la perdería.
  const hydrated = useHydrated();
  const [createError, setCreateError] = useState<string | null>(null);
  const [focusedAction, setFocusedAction] = useState<string | null>(null);
  const untitledWorkspace = t('home.workspace.untitled', locale);
  const [templateOpen, setTemplateOpen] = useState(false);

  const openWorkspace = (id: string) => router.push({ pathname: '/workspace', params: { id } });

  // Una sola creación en curso: con la latencia de una carpeta, otra pulsación creaba otro espacio.
  const [createOnce] = useState(() => singleFlight(async (target: WorkspaceStorage, name: string) => createEmptyWorkspaceNamed(target, name)));
  const [creating, setCreating] = useState(false);
  // Sigue desactivado hasta volver al inicio: entre crear y cambiar de pantalla también se ignora otra pulsación.
  useFocusEffect(useCallback(() => { setCreating(false); }, []));
  const createWorkspace = async () => {
    if (createOnce.busy() || creating) return;
    const name = draftName.trim() === '' ? untitledWorkspace : draftName.trim();
    setCreating(true);
    let navigated = false;
    try {
      const created = await createOnce(storage, name);
      if (!created) return;
      if (!created.ok) {
        setCreateError(describeFailure(created.issues));
        return;
      }
      setCreateError(null);
      setDraftName('');
      openWorkspace(created.value.id);
      navigated = true;
    } finally {
      if (!navigated) setCreating(false);
    }
  };

  const openFolder = async () => {
    // Abrir una carpeta cambia el almacenamiento de la sesión: los espacios del navegador sin exportar
    // dejarían de estar disponibles, así que nunca se descartan sin confirmación (ADR 0011).
    const pending = session.unexported.length;
    if (pending > 0 && Platform.OS === 'web') {
      const pendingText = t(pending === 1 ? 'home.openFolder.pending.one' : 'home.openFolder.pending.many', locale, { count: String(pending) });
      const confirmed = window.confirm(t('home.openFolder.confirm', locale, { pending: pendingText }));
      if (!confirmed) {
        setCreateError(t('home.openFolder.cancelled', locale));
        return;
      }
    }
    const result = await session.connectFolder();
    setCreateError(result.ok ? null : result.message);
  };

  const reopenFolder = async () => {
    const result = await session.reconnectFolder();
    setCreateError(result.ok ? null : result.message);
  };

  const importZip = async () => {
    const outcome = await session.importArchive();
    if (outcome === null) return;
    if (!outcome.ok) {
      setCreateError(outcome.message);
      return;
    }
    setCreateError(null);
    router.push({ pathname: '/workspace', params: { id: outcome.value.summary.id, notice: outcome.message } });
  };

  const showReopen = Platform.OS !== 'web' && session.savedFolder !== null;
  const showZip = Platform.OS === 'web' && session.mode === 'memory';
  const numbers = numberActions([
    'create', 'folder', ...(showReopen ? ['reopen' as const] : []), ...(showZip ? ['zip' as const] : []), 'template',
  ] as const);

  const actionFocus = (key: string) => ({
    onFocus: () => setFocusedAction(key),
    onBlur: () => setFocusedAction((current) => (current === key ? null : current)),
  });
  const actionBorder = (key: string) => ({
    borderColor: focusedAction === key ? colors.selection : 'transparent',
    borderTopColor: focusedAction === key ? colors.selection : colors.gridLine,
  });

  return (
    <SafeAreaView testID="home-screen" style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.page, { padding: compact ? 20 : 44 }]}>
        <View style={[styles.header, { borderColor: colors.border }]}>
          <View style={styles.brand}>
            <BrandMark size={46} />
            <Text style={[styles.brandName, { color: colors.textPrimary }]}>NoutyNotes</Text>
          </View>

          <View accessibilityLabel={t('home.appearance.label', locale)} style={[styles.themeControl, { borderColor: colors.border }]}>
            {themeOptions.map(({ value, labelKey, accessibilityLabelKey }) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={t(accessibilityLabelKey, locale)}
                accessibilityState={{ selected: preference === value }}
                {...(Platform.OS === 'web' ? { 'aria-pressed': preference === value } : {})}
                onPress={() => setPreference(value)}
                onFocus={() => setFocusedTheme(value)}
                onBlur={() => setFocusedTheme(null)}
                style={[
                  styles.themeButton,
                  {
                    backgroundColor: preference === value ? colors.accent : colors.surface,
                    borderColor: focusedTheme === value ? colors.selection : colors.surface,
                  },
                ]}
              >
                <Text style={[styles.themeLabel, { color: preference === value ? colors.accentText : colors.textPrimary }]}>
                  {t(labelKey, locale)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.metaRow, { borderColor: colors.gridLine }]}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('home.eyebrow.desk', locale)}</Text>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('home.eyebrow.edition', locale)}</Text>
        </View>

        <View style={[styles.main, { flexDirection: compact ? 'column' : 'row', gap: compact ? 36 : 56 }]}>
          <View testID="home-introduction" style={[styles.introduction, compact ? styles.stackedSection : null]}>
            <View style={[styles.label, { backgroundColor: colors.accent, borderColor: colors.border }]}>
              <Text style={[styles.eyebrow, { color: colors.accentText }]}>{t('home.eyebrow.tagline', locale)}</Text>
            </View>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary, fontSize: compact ? 44 : 64 }]}>
              {t('home.title.line1', locale)}{ '\n' }{t('home.title.line2', locale)}
            </Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              {t('home.description.line1', locale)}{ '\n' }{t('home.description.line2', locale)}
            </Text>

            <View style={[styles.note, { backgroundColor: colors.note, borderColor: colors.border }]}>
              <Text style={[styles.eyebrow, { color: colors.noteText }]}>{t('home.note.eyebrow', locale)}</Text>
              <Text style={[styles.noteText, { color: colors.noteText }]}>
                {t('home.note.line1', locale)}{ '\n' }{t('home.note.line2', locale)}
              </Text>
              <View style={[styles.noteLine, { backgroundColor: colors.noteText }]} />
            </View>
          </View>

          <View testID="home-workspace" style={[styles.workspaceSection, compact ? styles.stackedSection : null]}>
            <View style={[styles.folderTab, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.eyebrow, { color: colors.textPrimary }]}>{t('home.folderTab', locale)}</Text>
            </View>
            <View style={[styles.workspace, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text accessibilityRole="header" style={[styles.panelTitle, { color: colors.textPrimary }]}>
                {t('home.panelTitle.line1', locale)}{ '\n' }{t('home.panelTitle.line2', locale)}
              </Text>
              <Text style={[styles.panelDescription, { color: colors.textSecondary }]}>
                {t('home.panelDescription', locale)}
              </Text>
              <View style={styles.createForm}>
                <TextField
                  label={t('home.nameField.label', locale)}
                  value={draftName}
                  onChangeText={setDraftName}
                  placeholder={untitledWorkspace}
                  onSubmitEditing={() => void createWorkspace()}
                  editable={hydrated}
                />
              </View>
              {createError ? (
                <Text accessibilityRole="alert" style={[styles.error, { color: colors.textPrimary, borderColor: colors.border }]}>
                  {createError}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('home.create.label', locale)}
                  accessibilityHint={session.mode === 'folder' ? t('home.create.hint.folder', locale) : t('home.create.hint.memory', locale)}
                  accessibilityState={{ busy: creating, disabled: creating }}
                  disabled={creating}
                  onPress={() => void createWorkspace()}
                  {...actionFocus('create')}
                  style={[styles.action, actionBorder('create')]}
                >
                  <Text style={[styles.actionNumber, { color: colors.textSecondary }]}>{numbers.create}</Text>
                  <View style={styles.actionText}>
                    <Text style={[styles.actionTitle, { color: colors.textPrimary }]}>{creating ? t('home.create.title.creating', locale) : t('home.create.title', locale)}</Text>
                    <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>{t('home.create.description', locale)}</Text>
                  </View>
                  <View style={[styles.actionBadge, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                    <Text style={[styles.actionSymbol, { color: colors.accentText }]}>+</Text>
                  </View>
                </Pressable>
                <Pressable
                  testID="open-folder"
                  disabled={!hydrated || !session.folderSupported}
                  accessibilityRole="button"
                  accessibilityLabel={session.mode === 'folder' ? t('home.folder.change.label', locale) : t('home.folder.open.label', locale)}
                  accessibilityState={{ disabled: !hydrated || !session.folderSupported }}
                  onPress={() => void openFolder()}
                  {...actionFocus('folder')}
                  style={[styles.action, actionBorder('folder')]}
                >
                  <Text style={[styles.actionNumber, { color: colors.textSecondary }]}>{numbers.folder}</Text>
                  <View style={styles.actionText}>
                    <Text style={[styles.actionTitle, { color: colors.textPrimary }]}>{session.mode === 'folder' ? t('home.folder.change.label', locale) : t('home.folder.open.label', locale)}</Text>
                    <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>
                      {session.folderSupported ? t('home.folder.description.supported', locale) : t('home.folder.description.unsupported', locale)}
                    </Text>
                  </View>
                  <Text style={[styles.actionSymbol, { color: colors.textSecondary }]}>↗</Text>
                </Pressable>
                {showReopen && session.savedFolder ? (
                  <Pressable
                    testID="reopen-folder"
                    accessibilityRole="button"
                    accessibilityLabel={t('home.reopen.label', locale, { name: session.savedFolder.name })}
                    accessibilityHint={t('home.reopen.hint', locale)}
                    onPress={() => void reopenFolder()}
                    {...actionFocus('reopen')}
                    style={[styles.action, actionBorder('reopen')]}
                  >
                    <Text style={[styles.actionNumber, { color: colors.textSecondary }]}>{numbers.reopen}</Text>
                    <View style={styles.actionText}>
                      <Text style={[styles.actionTitle, { color: colors.textPrimary }]}>{t('home.reopen.label', locale, { name: session.savedFolder.name })}</Text>
                      <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>{t('home.reopen.description', locale)}</Text>
                    </View>
                    <Text style={[styles.actionSymbol, { color: colors.textSecondary }]}>↺</Text>
                  </Pressable>
                ) : null}
                {showZip ? (
                  <Pressable
                    testID="import-zip"
                    disabled={!session.archiveSupported}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.zip.label', locale)}
                    accessibilityHint={t('home.zip.hint', locale)}
                    accessibilityState={{ disabled: !session.archiveSupported }}
                    onPress={() => void importZip()}
                    {...actionFocus('zip')}
                    style={[styles.action, actionBorder('zip')]}
                  >
                    <Text style={[styles.actionNumber, { color: colors.textSecondary }]}>{numbers.zip}</Text>
                    <View style={styles.actionText}>
                      <Text style={[styles.actionTitle, { color: colors.textPrimary }]}>{t('home.zip.label', locale)}</Text>
                      <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>{t('home.zip.description', locale)}</Text>
                    </View>
                    <Text style={[styles.actionSymbol, { color: colors.textSecondary }]}>⤓</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  testID="open-template-picker"
                  accessibilityRole="button"
                  accessibilityLabel={t('home.template.title', locale)}
                  accessibilityHint={t('home.template.hint', locale)}
                  onPress={() => setTemplateOpen(true)}
                  {...actionFocus('template')}
                  style={[styles.action, actionBorder('template')]}
                >
                  <Text style={[styles.actionNumber, { color: colors.textSecondary }]}>{numbers.template}</Text>
                  <View style={styles.actionText}>
                    <Text style={[styles.actionTitle, { color: colors.textPrimary }]}>{t('home.template.title', locale)}</Text>
                    <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>{t('home.template.description', locale)}</Text>
                  </View>
                  <Text style={[styles.actionSymbol, { color: colors.textSecondary }]}>▦</Text>
                </Pressable>
              </View>
              <View testID="memory-notice" style={[styles.comingSoon, { backgroundColor: colors.surfaceRaised }]}>
                <Text style={[styles.comingSoonText, { color: colors.textPrimary }]}>
                  {session.mode === 'folder'
                    ? t(Platform.OS === 'web' ? 'home.notice.folder.web' : 'home.notice.folder.native', locale)
                    : t(Platform.OS === 'web' ? 'home.notice.memory.web' : 'home.notice.memory.native', locale, { loss: t('home.notice.memoryLoss', locale) })}
                </Text>
              </View>
              <View testID="session-workspaces" style={styles.sessionList}>
                <Text accessibilityRole="header" style={[styles.eyebrow, { color: colors.textSecondary }]}>{t(session.mode === 'folder' ? 'home.sessionList.folder' : 'home.sessionList.session', locale)}</Text>
                {workspaces.length === 0 ? (
                  <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>{t('home.sessionList.empty', locale)}</Text>
                ) : (
                  workspaces.map((workspace) => (
                    <Pressable
                      key={workspace.id}
                      accessibilityRole="button"
                      accessibilityLabel={t('home.workspace.open.label', locale, { name: workspace.name })}
                      {...(session.unexported.includes(workspace.id) ? { accessibilityHint: t('home.workspace.unexported.hint', locale) } : {})}
                      onPress={() => openWorkspace(workspace.id)}
                      {...actionFocus(`open:${workspace.id}`)}
                      style={[styles.sessionItem, actionBorder(`open:${workspace.id}`)]}
                    >
                      <Text style={[styles.actionTitle, styles.sessionName, { color: colors.textPrimary }]}>{workspace.name}</Text>
                      {session.unexported.includes(workspace.id) ? (
                        <Text testID={`unexported-${workspace.id}`} style={[styles.unexported, { color: colors.noteText, backgroundColor: colors.note }]}>{t('home.workspace.unexported.badge', locale)}</Text>
                      ) : null}
                      <Text style={[styles.actionSymbol, { color: colors.textSecondary }]}>→</Text>
                    </Pressable>
                  ))
                )}
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.footer, { borderColor: colors.border }]}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('home.footer.tagline', locale)}</Text>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('home.footer.version', locale)}</Text>
        </View>
      </ScrollView>
      <TemplatePicker
        visible={templateOpen}
        compact={compact}
        storage={storage}
        locale={locale}
        onClose={() => setTemplateOpen(false)}
        onCreated={(id) => { setTemplateOpen(false); openWorkspace(id); }}
      />
    </SafeAreaView>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });
const display = Platform.select({ web: 'Arial Black, Arial, sans-serif', android: 'sans-serif-black', default: 'System' });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flexGrow: 1, width: '100%', maxWidth: 1440, alignSelf: 'center' },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 22, paddingBottom: 24, borderBottomWidth: 2 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandName: { fontSize: 27, fontWeight: '900', letterSpacing: -1 },
  themeControl: { flexDirection: 'row', borderWidth: 1, padding: 3, gap: 2 },
  themeButton: { minHeight: 44, minWidth: 68, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  themeLabel: { fontSize: 13, fontWeight: '600' },
  metaRow: { paddingVertical: 16, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1 },
  eyebrow: { fontFamily: mono, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  main: { flex: 1, alignItems: 'stretch', paddingVertical: 52 },
  introduction: { flex: 1, minWidth: 0, justifyContent: 'center' },
  label: { borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start', marginBottom: 24 },
  title: { fontFamily: display, fontWeight: '900', letterSpacing: -2.5, marginBottom: 22 },
  description: { fontSize: 18, lineHeight: 29 },
  note: { marginTop: 36, padding: 22, borderWidth: 1, alignSelf: 'flex-start', maxWidth: '100%', transform: [{ rotate: '-2deg' }] },
  noteText: { fontSize: 21, lineHeight: 30, fontWeight: '600', marginTop: 14 },
  noteLine: { width: 70, height: 2, marginTop: 20 },
  workspaceSection: { flex: 1, minWidth: 0, justifyContent: 'center', paddingTop: 8 },
  // Apilado: cada sección mide su contenido; con flex: 1 (base 0) se encogía y el pie la tapaba.
  stackedSection: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  folderTab: { alignSelf: 'flex-start', borderWidth: 2, borderBottomWidth: 0, paddingHorizontal: 20, paddingVertical: 12, borderTopRightRadius: 16 },
  workspace: { borderWidth: 2, padding: 24 },
  panelTitle: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -1 },
  panelDescription: { fontSize: 15, lineHeight: 23, marginTop: 12 },
  actions: { marginTop: 20 },
  createForm: { marginTop: 24 },
  error: { marginTop: 12, padding: 12, borderWidth: 1, fontSize: 14, lineHeight: 20 },
  action: { borderWidth: 2, paddingVertical: 18, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionBadge: { width: 36, height: 36, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  sessionList: { marginTop: 24, gap: 8 },
  sessionName: { flex: 1, minWidth: 0 },
  unexported: { fontFamily: mono, fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 3 },
  sessionItem: { minHeight: 48, borderWidth: 2, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  actionNumber: { fontFamily: mono, fontSize: 11 },
  actionText: { flex: 1 },
  actionTitle: { fontSize: 17, fontWeight: '700' },
  actionDescription: { fontSize: 13, lineHeight: 20, marginTop: 5 },
  actionSymbol: { fontSize: 24 },
  comingSoon: { marginTop: 8, padding: 14 },
  comingSoonText: { fontSize: 12, lineHeight: 19 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, paddingTop: 18, borderTopWidth: 2 },
});
