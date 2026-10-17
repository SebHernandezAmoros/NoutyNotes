import type { WorkspaceSummary } from '@noutynotes/application';
import { resolveLayoutMode, useLocale, useTheme, useWindowWidth } from '@noutynotes/ui';
import type { ThemePreference } from '@noutynotes/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { useHydrated } from '../components/useHydrated';
import { t } from '../i18n';
import { chooseFolder } from '../session/folderAccess';
import type { RecentFolderEntry, RecentProjectEntry } from '../session/recentItems';
import { describeFailure } from '../session/messages';
import { useRecentConnections } from '../session/useRecentConnections';
import { useWorkspaceSession, useWorkspaceStorage } from '../session/WorkspaceSession';
import { numberActions } from './actions';
import { CreateProjectDialog } from './CreateProjectDialog';
import { mergeHomeProjects } from './homeProjects';
import { createProjectAtTarget } from './projectCreation';
import type { ProjectCreationTarget } from './projectCreation';
import { TemplatePicker } from './TemplatePicker';

const themeOptions: { value: ThemePreference; labelKey: 'settings.theme.light' | 'settings.theme.dark' | 'settings.theme.system'; accessibilityLabelKey: 'home.theme.light.label' | 'home.theme.dark.label' | 'home.theme.system.label' }[] = [
  { value: 'light', labelKey: 'settings.theme.light', accessibilityLabelKey: 'home.theme.light.label' },
  { value: 'dark', labelKey: 'settings.theme.dark', accessibilityLabelKey: 'home.theme.dark.label' },
  { value: 'system', labelKey: 'settings.theme.system', accessibilityLabelKey: 'home.theme.system.label' },
];

/** Espacios guardados en la memoria de esta sesión; se vuelven a leer al regresar a la pantalla.
 * UX7-E2A: expone también `loading` — mientras `storage.list()` del backend recién conectado sigue en
 * curso, un proyecto reciente de esa misma carpeta no debe interpretarse como «Reconectar» (E2A-02):
 * una lista todavía no cargada no es evidencia de que el proyecto o el permiso se perdieron. */
function useSessionWorkspaces(): { readonly workspaces: readonly WorkspaceSummary[]; readonly loading: boolean } {
  const storage = useWorkspaceStorage();
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    void storage.list().then((listed) => {
      if (!active) return;
      if (listed.ok) setWorkspaces(listed.value);
      setLoading(false);
    });
    return () => { active = false; };
  }, [storage]));
  return { workspaces, loading };
}

export function HomeScreen() {
  const { theme, preference, setPreference } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const compact = resolveLayoutMode(useWindowWidth()) === 'compact';
  const [focusedTheme, setFocusedTheme] = useState<ThemePreference | null>(null);
  const storage = useWorkspaceStorage();
  const session = useWorkspaceSession();
  const { workspaces, loading: workspacesLoading } = useSessionWorkspaces();
  // UX7-E2B: identidad de carpetas, Recientes y reconexión por evidencia real — compartido con el
  // catálogo de `ProjectSheet` (UX7-E2C) en `WorkspaceScreen.tsx`.
  const recent = useRecentConnections();
  const { currentBackend, currentFolderId } = recent;
  const [projectName, setProjectName] = useState('');
  // En el HTML estático el campo no admite escritura: el render del cliente la perdería.
  const hydrated = useHydrated();
  const [createError, setCreateError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [focusedAction, setFocusedAction] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creationTarget, setCreationTarget] = useState<ProjectCreationTarget | null>(null);
  const [selectingFolder, setSelectingFolder] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdPendingActivation, setCreatedPendingActivation] = useState<WorkspaceSummary | null>(null);
  const createGuard = useRef(false);

  const openWorkspace = (id: string) => router.push({ pathname: '/workspace', params: { id } });

  // Una sola creación en curso: con la latencia de una carpeta, otra pulsación creaba otro espacio.
  // Sigue desactivado hasta volver al inicio: entre crear y cambiar de pantalla también se ignora otra pulsación.
  useFocusEffect(useCallback(() => { createGuard.current = false; setCreating(false); }, []));
  const currentTarget = (): ProjectCreationTarget => ({
    kind: 'current', storage, backend: currentBackend, folderId: currentFolderId,
    folderName: session.mode === 'folder'
      ? (recent.folders.find((folder) => folder.id === currentFolderId)?.name ?? session.activeFolderKey ?? 'Carpeta actual')
      : 'Memoria de esta sesión',
  });

  const openCreateDialog = () => {
    setProjectName('');
    setCreationTarget(currentTarget());
    setCreatedPendingActivation(null);
    setDialogError(null);
    setCreateOpen(true);
  };

  const closeCreateDialog = () => {
    if (creating) return;
    setCreateOpen(false);
    setCreatedPendingActivation(null);
    setDialogError(null);
  };

  const chooseCreationFolder = async () => {
    if (selectingFolder || creating || createdPendingActivation) return;
    setSelectingFolder(true);
    setDialogError(null);
    try {
      const selected = await chooseFolder();
      if (!selected) {
        setDialogError('Este navegador no permite elegir carpetas locales.');
        return;
      }
      const checked = await selected.storage.list();
      if (!checked.ok) {
        setDialogError(describeFailure(checked.issues));
        return;
      }
      setCreationTarget({ kind: 'selected-web-folder', storage: selected.storage, handle: selected.handle, folderName: selected.name });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setDialogError('No se pudo comprobar la carpeta elegida.');
    } finally {
      setSelectingFolder(false);
    }
  };

  const confirmLeavingMemory = () => {
    const pending = session.unexported.length;
    if (pending === 0 || Platform.OS !== 'web') return true;
    const pendingText = t(pending === 1 ? 'home.openFolder.pending.one' : 'home.openFolder.pending.many', locale, { count: String(pending) });
    return window.confirm(t('home.openFolder.confirm', locale, { pending: pendingText }));
  };

  const completeCreatedProject = (summary: WorkspaceSummary, backend: 'web' | 'android' | 'memory', folderId: string | null) => {
    recent.recordProjectUse({ workspaceId: summary.id, name: summary.name, backend, folderId });
    setCreateOpen(false);
    setCreatedPendingActivation(null);
    openWorkspace(summary.id);
  };

  const createProject = async () => {
    if (createGuard.current || creating || selectingFolder || !creationTarget) return;
    if (creationTarget.kind === 'selected-web-folder' && !confirmLeavingMemory()) {
      setDialogError('La creación se canceló; tus proyectos temporales siguen en esta sesión.');
      return;
    }
    createGuard.current = true;
    setCreating(true);
    setDialogError(null);
    try {
      if (createdPendingActivation && creationTarget.kind === 'selected-web-folder') {
        const activated = await recent.connectSelectedWebFolder(creationTarget.handle, creationTarget.folderName);
        if (!activated.ok) {
          setDialogError(`El proyecto ya existe en «${creationTarget.folderName}», pero no se pudo abrir: ${activated.message}`);
          return;
        }
        completeCreatedProject(createdPendingActivation, 'web', activated.folderId);
        return;
      }
      const result = await createProjectAtTarget({ name: projectName, target: creationTarget, activate: recent.connectSelectedWebFolder });
      if (!result.ok) {
        if (result.stage === 'validation') setDialogError(result.reason === 'required' ? 'Escribe un nombre para el proyecto.' : 'El nombre contiene caracteres no permitidos.');
        else if (result.stage === 'create') setDialogError(describeFailure(result.issues));
        else {
          setCreatedPendingActivation(result.created);
          setDialogError(`El proyecto «${result.created.name}» ya se creó en «${creationTarget.folderName}», pero no se pudo abrir: ${result.message}. Puedes reintentar sin volver a crearlo.`);
        }
        return;
      }
      completeCreatedProject(result.summary, result.backend, result.folderId);
    } finally {
      createGuard.current = false;
      setCreating(false);
    }
  };

  /** Abrir una carpeta cambia el almacenamiento de la sesión: los espacios del navegador sin exportar
   * dejarían de estar disponibles, así que nunca se descartan sin confirmación (ADR 0011). La
   * identidad/reconexión real vive en `useRecentConnections` (UX7-E2A/B), compartida con `ProjectSheet`. */
  const openFolder = async (): Promise<{ ok: true; folderId: string } | { ok: false; message: string }> => {
    const pending = session.unexported.length;
    if (pending > 0 && Platform.OS === 'web') {
      const pendingText = t(pending === 1 ? 'home.openFolder.pending.one' : 'home.openFolder.pending.many', locale, { count: String(pending) });
      const confirmed = window.confirm(t('home.openFolder.confirm', locale, { pending: pendingText }));
      if (!confirmed) {
        const message = t('home.openFolder.cancelled', locale);
        setCreateError(message);
        return { ok: false, message };
      }
    }
    const result = await recent.connectNewFolder();
    setCreateError(result.ok ? null : result.message);
    return result;
  };

  const reopenFolder = async (): Promise<{ ok: true; folderId: string } | { ok: false; message: string }> => {
    const result = await recent.reopenSavedAndroidFolder();
    setCreateError(result.ok ? null : result.message);
    return result;
  };

  const reconnectFolderEntry = async (entry: RecentFolderEntry) => {
    const result = await recent.reconnectFolderEntry(entry);
    setCreateError(result.ok ? null : result.message);
    return result;
  };

  /** UX7-E1/E2B: abre un proyecto reciente si su carpeta ya está disponible; si no, reconecta primero
   * (handle guardado, URI SAF o selector nativo, según corresponda) y solo abre si la carpeta
   * reconectada corresponde exactamente a la que el proyecto espera (`folderId` opaco, nunca nombre). */
  const openRecentProject = async (entry: RecentProjectEntry) => {
    const live = entry.backend === currentBackend && entry.folderId === currentFolderId
      && workspaces.some((workspace) => workspace.id === entry.workspaceId);
    if (live) {
      recent.recordProjectUse({ workspaceId: entry.workspaceId, name: entry.name, backend: entry.backend, folderId: entry.folderId });
      openWorkspace(entry.workspaceId);
      return;
    }
    if (entry.backend === 'memory') return;
    const folderEntry = recent.folders.find((folder) => folder.id === entry.folderId);
    if (!folderEntry) return;
    const result = await reconnectFolderEntry(folderEntry);
    if (result.ok && result.folderId === entry.folderId) {
      recent.recordProjectUse({ workspaceId: entry.workspaceId, name: entry.name, backend: entry.backend, folderId: entry.folderId });
      openWorkspace(entry.workspaceId);
    }
  };

  const projectStatus = (entry: RecentProjectEntry) => recent.projectStatus(entry, workspaces.map((workspace) => workspace.id), workspacesLoading);
  const homeProjects = mergeHomeProjects({
    recentProjects: recent.projects,
    sessionProjects: workspaces,
    currentBackend,
    currentFolderId,
    unexported: session.unexported,
  });

  const importZip = async () => {
    const outcome = await session.importArchive();
    if (outcome === null) return;
    if (!outcome.ok) {
      setCreateError(outcome.message);
      return;
    }
    setCreateError(null);
    recent.recordProjectUse({ workspaceId: outcome.value.summary.id, name: outcome.value.summary.name, backend: 'memory', folderId: null });
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
              <View testID="home-recent" style={styles.recentSection}>
                <Text accessibilityRole="header" style={[styles.eyebrow, { color: colors.textSecondary }]}>{t('home.projects.title', locale)}</Text>
                {homeProjects.length === 0 ? (
                  <View testID="home-projects-empty" style={[styles.emptyProjects, { borderColor: colors.gridLine }]}>
                    <Text style={[styles.actionTitle, { color: colors.textPrimary }]}>{t('home.projects.empty.title', locale)}</Text>
                    <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>{t('home.projects.empty.description', locale)}</Text>
                  </View>
                ) : homeProjects.map((entry) => {
                  const status = entry.recent ? projectStatus(entry.recent) : 'available';
                  const folderName = entry.backend === 'memory' ? t('home.projects.origin.session', locale) : (recent.folders.find((folder) => folder.id === entry.folderId)?.name ?? t('home.projects.origin.unknown', locale));
                  return (
                    <View key={entry.key} testID={`home-project-${entry.key}`} style={[styles.recentItem, { borderColor: colors.gridLine }]}>
                      <View style={styles.recentItemHeader}>
                        <View style={styles.projectIdentity}>
                          <Text numberOfLines={1} style={[styles.actionTitle, { color: colors.textPrimary }]}>{entry.name}</Text>
                          <Text numberOfLines={1} style={[styles.projectOrigin, { color: colors.textSecondary }]}>{folderName}</Text>
                        </View>
                        {entry.unexported ? <Text testID={`unexported-${entry.workspaceId}`} style={[styles.unexported, { color: colors.noteText, backgroundColor: colors.note }]}>SIN EXPORTAR</Text> : null}
                        {entry.canForget ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('home.recent.forget.project.accessibilityLabel', locale, { name: entry.name })}
                            onPress={() => entry.recent && recent.forgetProjectEntry(entry.recent.id)}
                            style={styles.recentForget}
                          >
                            <Text style={[styles.recentForgetText, { color: colors.textSecondary }]}>{t('home.recent.forget.label', locale)}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                      {status === 'available' || status === 'reconnect' ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t(status === 'available' ? 'home.recent.project.open.accessibilityLabel' : 'home.recent.project.reconnect.accessibilityLabel', locale, { name: entry.name })}
                          onPress={() => entry.recent ? void openRecentProject(entry.recent) : (() => { recent.recordProjectUse({ workspaceId: entry.workspaceId, name: entry.name, backend: entry.backend, folderId: entry.folderId }); openWorkspace(entry.workspaceId); })()}
                          style={styles.recentAction}
                        >
                          <Text style={[styles.recentActionText, { color: colors.textPrimary }]}>{t(status === 'available' ? 'home.recent.project.open.label' : 'home.recent.project.reconnect.label', locale)}</Text>
                        </Pressable>
                      ) : (
                        <Text testID={`home-project-status-${entry.key}`} style={[styles.actionDescription, { color: colors.textSecondary }]}>
                          {t(status === 'loading' ? 'home.recent.project.loading' : status === 'missing' ? 'home.recent.project.missing' : status === 'temporary' ? 'home.recent.project.temporary' : 'home.recent.project.unavailable', locale)}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
              {createError ? (
                <Text accessibilityRole="alert" style={[styles.error, { color: colors.textPrimary, borderColor: colors.border }]}>
                  {createError}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Text style={[styles.actionGroupLabel, { color: colors.textSecondary }]}>{t('home.actions.primary', locale)}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('home.create.dialog.title', locale)}
                  accessibilityHint={session.mode === 'folder' ? t('home.create.hint.folder', locale) : t('home.create.hint.memory', locale)}
                  accessibilityState={{ busy: creating, disabled: !hydrated || creating }}
                  disabled={!hydrated || creating}
                  onPress={openCreateDialog}
                  {...actionFocus('create')}
                  style={[styles.action, actionBorder('create')]}
                >
                  <Text style={[styles.actionNumber, { color: colors.textSecondary }]}>{numbers.create}</Text>
                  <View style={styles.actionText}>
                    <Text style={[styles.actionTitle, { color: colors.textPrimary }]}>{t('home.create.title', locale)}</Text>
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
                <Text style={[styles.actionGroupLabel, styles.secondaryLabel, { color: colors.textSecondary }]}>{t('home.actions.secondary', locale)}</Text>
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
        onCreated={(id, name) => {
          setTemplateOpen(false);
          recent.recordProjectUse({ workspaceId: id, name, backend: currentBackend, folderId: currentFolderId });
          openWorkspace(id);
        }}
      />
      <CreateProjectDialog
        visible={createOpen}
        compact={compact}
        name={projectName}
        target={creationTarget ?? currentTarget()}
        selecting={selectingFolder}
        creating={creating}
        createdPending={createdPendingActivation !== null}
        error={dialogError}
        onNameChange={setProjectName}
        onChooseFolder={() => void chooseCreationFolder()}
        onCancel={closeCreateDialog}
        onCreate={() => void createProject()}
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
  actionGroupLabel: { fontFamily: mono, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 },
  secondaryLabel: { marginTop: 22 },
  createForm: { marginTop: 24 },
  error: { marginTop: 12, padding: 12, borderWidth: 1, fontSize: 14, lineHeight: 20 },
  action: { borderWidth: 2, paddingVertical: 18, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionBadge: { width: 36, height: 36, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  sessionList: { marginTop: 24, gap: 8 },
  sessionName: { flex: 1, minWidth: 0 },
  recentSection: { marginTop: 24, gap: 12 },
  emptyProjects: { borderWidth: 2, padding: 14 },
  projectIdentity: { flex: 1, minWidth: 0 },
  projectOrigin: { fontSize: 12, marginTop: 3 },
  recentGroup: { gap: 6 },
  recentGroupTitle: { fontFamily: mono, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 4 },
  // Fila en dos líneas (nombre arriba, estado/acción abajo): un estado largo ("Sesión temporal…") no
  // debe recortar el nombre a una sola letra compitiendo por ancho en una sola fila (UX7-E1).
  recentItem: { borderWidth: 2, paddingHorizontal: 10, paddingVertical: 8, gap: 4 },
  recentItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  recentAction: { alignSelf: 'flex-start', minHeight: 32, paddingHorizontal: 8, justifyContent: 'center' },
  recentActionText: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  recentForget: { minHeight: 32, paddingHorizontal: 6, justifyContent: 'center' },
  recentForgetText: { fontSize: 11, fontWeight: '600' },
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
