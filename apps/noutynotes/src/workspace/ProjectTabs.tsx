import { createEmptyWorkspaceNamed } from '@noutynotes/application';
import type { WorkspaceStorage, WorkspaceSummary } from '@noutynotes/application';
import type { Locale } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import { describeFailure } from '../session/messages';
import { useRecentConnections } from '../session/useRecentConnections';
import type { RecentProjectEntry } from '../session/recentItems';

interface ProjectSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly locale: Locale;
  /** Proyectos del backend activo (igual que antes de UX7-E2C). */
  readonly projects: readonly WorkspaceSummary[];
  readonly currentId: string | undefined;
  /** Cambia de proyecto dentro del MISMO backend; quien llama guarda antes el borrador pendiente. */
  readonly onOpen: (id: string) => void;
  /** UX7-E2D: carpeta activa, para crear el proyecto nuevo ahí mismo. */
  readonly storage: WorkspaceStorage;
  /** UX7-E2D: tras crear con éxito — quien llama registra el uso y navega (misma protección que `onOpen`). */
  readonly onCreated: (id: string, name: string) => void;
  /** UX7-E2C: abrir un proyecto reciente de OTRA carpeta — reconecta su carpeta (handle guardado, URI
   * SAF o selector nativo) y solo navega si la reconexión corresponde exactamente a esa carpeta; quien
   * llama resuelve antes la edición pendiente del proyecto actual (igual que cualquier cambio de
   * contexto en el Workspace). */
  readonly onOpenOtherProject: (entry: RecentProjectEntry) => void;
}

const numbered = (index: number) => String(index + 1).padStart(2, '0');

/**
 * Selector de proyectos abierto desde «Proyectos» en la cabecera, en cualquier ancho de escritorio
 * (ADR 0048) — conserva la hoja inferior en escritorio y móvil (UX7-E2, decisión D3). UX7-E2C añade un
 * catálogo de proyectos recientes de otras carpetas conocidas (D2); UX7-E2D añade creación in situ
 * (D1) — «+ Nuevo proyecto» ya no navega a Inicio.
 */
export function ProjectSheet({ visible, onClose, locale, projects, currentId, onOpen, storage, onCreated, onOpenOtherProject }: ProjectSheetProps) {
  const recent = useRecentConnections();
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const close = () => {
    if (creating) return;
    setCreatingOpen(false);
    setDraftName('');
    setCreateError(null);
    onClose();
  };

  const create = async () => {
    if (creating) return;
    const name = draftName.trim() === '' ? t('home.workspace.untitled', locale) : draftName.trim();
    setCreating(true);
    try {
      const result = await createEmptyWorkspaceNamed(storage, name);
      if (!result.ok) {
        setCreateError(describeFailure(result.issues));
        return;
      }
      setCreateError(null);
      setDraftName('');
      setCreatingOpen(false);
      onCreated(result.value.id, result.value.name);
    } finally {
      setCreating(false);
    }
  };

  // UX7-E2C: proyectos recientes de carpetas distintas a la activa, agrupados por carpeta. Un proyecto
  // ya visible en `projects` (backend activo) no se repite aquí — evita la duplicación ambigua.
  const otherProjects = recent.projects.filter((entry) => !(entry.backend === recent.currentBackend && entry.folderId === recent.currentFolderId));
  const otherGroups = new Map<string, RecentProjectEntry[]>();
  for (const entry of otherProjects) {
    const key = entry.backend === 'memory' ? 'memory' : (entry.folderId ?? 'unknown');
    const group = otherGroups.get(key);
    if (group) group.push(entry); else otherGroups.set(key, [entry]);
  }

  const statusAction = (entry: RecentProjectEntry) => {
    const status = recent.projectStatus(entry, [], false);
    if (status === 'available' || status === 'reconnect') {
      return (
        <ActionButton
          key={entry.id}
          testID={`project-sheet-other-${entry.id}`}
          label={`${t(status === 'available' ? 'home.recent.project.open.label' : 'home.recent.project.reconnect.label', locale)}  ${entry.name}`}
          accessibilityLabel={t(status === 'available' ? 'home.recent.project.open.accessibilityLabel' : 'home.recent.project.reconnect.accessibilityLabel', locale, { name: entry.name })}
          onPress={() => { onClose(); onOpenOtherProject(entry); }}
        />
      );
    }
    const text = status === 'temporary'
      ? `${t('home.recent.project.temporary', locale)} · ${t('home.recent.project.temporary.hint', locale)}`
      : `${t('home.recent.project.unavailable', locale)} · ${t('home.recent.project.unavailable.hint', locale)}`;
    return (
      <View key={entry.id} testID={`project-sheet-other-${entry.id}`} style={styles.otherUnavailable}>
        <Text style={styles.otherUnavailableName}>{entry.name}</Text>
        <Text style={styles.otherUnavailableHint}>{text}</Text>
      </View>
    );
  };

  return (
    <Dialog visible={visible} title={t('project.sheet.title', locale)} compact onClose={close} testID="project-sheet">
      <View style={styles.list}>
        {creatingOpen ? (
          <View testID="project-sheet-create-form" style={styles.createForm}>
            <TextField
              label={t('project.sheet.new.nameField', locale)}
              value={draftName}
              onChangeText={setDraftName}
              placeholder={t('home.workspace.untitled', locale)}
              onSubmitEditing={() => void create()}
              editable={!creating}
            />
            {createError ? <Text accessibilityRole="alert" style={styles.createError}>{createError}</Text> : null}
            <View style={styles.createActions}>
              <ActionButton
                testID="project-sheet-create-confirm"
                label={creating ? t('project.sheet.new.creating', locale) : t('project.sheet.new.create', locale)}
                tone="primary"
                disabled={creating}
                onPress={() => void create()}
              />
              <ActionButton
                testID="project-sheet-create-cancel"
                label={t('project.sheet.new.cancel', locale)}
                disabled={creating}
                onPress={() => { setCreatingOpen(false); setDraftName(''); setCreateError(null); }}
              />
            </View>
          </View>
        ) : (
          <ActionButton
            testID="project-sheet-new"
            label={t('project.sheet.new.label', locale)}
            accessibilityLabel={t('project.sheet.new.accessibilityLabel', locale)}
            tone="primary"
            onPress={() => setCreatingOpen(true)}
          />
        )}

        {projects.length > 0 ? (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>{t('project.sheet.section.current', locale)}</Text>
            {projects.map((project, index) => {
              const active = project.id === currentId;
              return (
                <ActionButton
                  key={project.id}
                  label={`${numbered(index)}  ${project.name}${active ? `  · ${t('project.sheet.current.badge', locale)}` : ''}`}
                  accessibilityLabel={active ? t('project.sheet.current.label', locale, { name: project.name }) : t('project.sheet.open.accessibilityLabel', locale, { name: project.name })}
                  pressed={active}
                  onPress={() => { onClose(); if (!active) onOpen(project.id); }}
                />
              );
            })}
          </View>
        ) : null}

        {otherGroups.size > 0 ? (
          <View testID="project-sheet-other-folders" style={styles.group}>
            <Text style={styles.groupTitle}>{t('project.sheet.section.other', locale)}</Text>
            {[...otherGroups.entries()].map(([key, entries]) => {
              const folderName = key === 'memory' ? null : (recent.folders.find((folder) => folder.id === key)?.name ?? t('project.sheet.folder.unknown', locale));
              return (
                <View key={key} style={styles.folderGroup}>
                  {folderName ? <Text style={styles.folderGroupTitle}>{folderName}</Text> : null}
                  {entries.map(statusAction)}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  group: { gap: 6, marginTop: 8 },
  groupTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  folderGroup: { gap: 6 },
  folderGroupTitle: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  otherUnavailable: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 2 },
  otherUnavailableName: { fontSize: 15, fontWeight: '700' },
  otherUnavailableHint: { fontSize: 12, marginTop: 2 },
  createForm: { gap: 8 },
  createActions: { flexDirection: 'row', gap: 8 },
  createError: { fontSize: 13 },
});
