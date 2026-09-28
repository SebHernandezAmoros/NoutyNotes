import { searchWorkspace, workspaceTags } from '@noutynotes/application';
import type { GlobalSearch, SearchResult } from '@noutynotes/application';
import type { CardId, CardTypeId, Workspace, WorkspaceId } from '@noutynotes/domain';
import type { Locale } from '@noutynotes/ui';
import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';

interface SearchPanelProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly busy: boolean;
  /** Proyectos de la sesión o de la carpeta: el alcance «Todos los proyectos». */
  readonly projectCount: number;
  readonly onGo: (result: SearchResult) => void;
  /** Ir a una tarjeta de otro proyecto (ADR 0020): guarda antes el borrador y abre ese proyecto. */
  readonly onGoProject: (workspaceId: WorkspaceId, cardId: CardId) => void;
  readonly onSearchAll: (query: string) => Promise<GlobalSearch>;
  readonly onRenameTag: (from: string, to: string) => Promise<boolean>;
  readonly onRemoveTag: (tag: string) => Promise<boolean>;
  readonly onClose: () => void;
}

type Scope = 'project' | 'all';
type Pending = { readonly kind: 'rename' | 'remove'; readonly tag: string; readonly count: number } | null;
type Global = { readonly query: string; readonly found: GlobalSearch } | 'searching' | null;

type PluralUnit = 'card' | 'project' | 'resultUpper' | 'projectUpper';
const unit = (base: PluralUnit, count: number, locale: Locale) =>
  t(count === 1 ? `unit.${base}.one` : `unit.${base}.many`, locale, { count: String(count) });

/**
 * Búsqueda en el proyecto abierto (ADR 0019) o en todos los proyectos (ADR 0020). La local es en vivo;
 * la global se lanza de forma explícita porque lee cada proyecto. El panel solo escribe al renombrar o
 * quitar una etiqueta, siempre con confirmación y el número de tarjetas.
 */
export function SearchPanel(props: SearchPanelProps) {
  const { visible, compact, workspace, busy, onGo, onRenameTag, onRemoveTag, onClose } = props;
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [scope, setScope] = useState<Scope>('project');
  const [query, setQuery] = useState('');
  const [typeId, setTypeId] = useState<CardTypeId | undefined>();
  const [pending, setPending] = useState<Pending>(null);
  const [newName, setNewName] = useState('');
  const [global, setGlobal] = useState<Global>(null);
  const results = searchWorkspace(workspace, query, typeId === undefined ? {} : { typeId });
  const tags = workspaceTags(workspace);
  const types = workspace.cardTypes
    .map((type) => ({ type, count: workspace.cards.filter((card) => card.typeId === type.id).length }))
    .filter(({ count }) => count > 0);
  const hasQuery = query.trim() !== '' || typeId !== undefined;
  const projects = unit('project', props.projectCount, locale);
  const toggleTag = (tag: string) => {
    const token = `#${tag}`;
    const words = query.trim().split(/\s+/).filter(Boolean);
    setQuery((words.includes(token) ? words.filter((word) => word !== token) : [...words, token]).join(' '));
  };
  const close = () => { setPending(null); onClose(); };
  const confirm = async () => {
    if (!pending || busy) return;
    const done = pending.kind === 'rename' ? await onRenameTag(pending.tag, newName) : await onRemoveTag(pending.tag);
    if (done) {
      setQuery((current) => current.split(/\s+/).filter((word) => word !== `#${pending.tag}`).join(' '));
      setPending(null);
      setNewName('');
    }
  };
  const searchAll = async () => {
    const text = query.trim();
    if (text === '' || global === 'searching') return;
    setGlobal('searching');
    setGlobal({ query: text, found: await props.onSearchAll(text) });
  };
  const resultCard = (result: SearchResult, go: () => void, key: string) => (
    <View key={key} testID={`search-result-${key}`} style={[styles.result, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text numberOfLines={2} style={[styles.resultTitle, { color: colors.textPrimary }]}>{result.title}</Text>
      <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary }]}>
        {`${result.typeLabel.toUpperCase()} · ${result.boards.length > 0 ? result.boards.map((board) => board.title).join(', ') : t('search.noBoard', locale)}`}
      </Text>
      {result.tags.length > 0 ? <Text numberOfLines={1} style={[styles.meta, { color: colors.selection }]}>{result.tags.map((tag) => `#${tag}`).join('  ')}</Text> : null}
      {result.excerpt !== '' ? <Text numberOfLines={2} style={[styles.excerpt, { color: colors.textPrimary }]}>{result.excerpt}</Text> : null}
      <ActionButton label={t('search.go', locale)} accessibilityLabel={t('search.go.accessibilityLabel', locale, { title: result.title })} onPress={go} />
    </View>
  );

  return (
    <Dialog visible={visible} title={t('tool.search', locale)} compact={compact} onClose={close} testID="search-panel">
      <View style={styles.row} accessibilityLabel={t('search.where', locale)}>
        <ActionButton label={t('search.scope.project', locale)} accessibilityLabel={t('search.scope.project.accessibilityLabel', locale)} pressed={scope === 'project'} onPress={() => setScope('project')} />
        <ActionButton label={t('search.scope.all.label', locale, { count: String(props.projectCount) })} accessibilityLabel={t('search.scope.all.accessibilityLabel', locale, { count: String(props.projectCount) })} pressed={scope === 'all'} onPress={() => setScope('all')} />
      </View>
      <TextField label={t('tool.search', locale)} value={query} onChangeText={setQuery} placeholder={t('search.input.placeholder', locale)} testID="search-input"
        {...(scope === 'all' ? { onSubmitEditing: () => void searchAll() } : {})} />

      {scope === 'project' ? (
        <>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {t('search.hint.project', locale)}
          </Text>

          {types.length > 1 ? (
            <>
              <Text style={[styles.section, { color: colors.textSecondary }]}>{t('search.section.types', locale)}</Text>
              <View style={styles.row}>
                {types.map(({ type, count }) => (
                  <ActionButton key={type.id} label={`${type.label} · ${count}`} pressed={typeId === type.id}
                    accessibilityLabel={`${t(typeId === type.id ? 'search.filter.remove' : 'search.filter.only', locale)} ${type.label} (${unit('card', count, locale)})`}
                    onPress={() => setTypeId((current) => (current === type.id ? undefined : type.id))} />
                ))}
              </View>
            </>
          ) : null}

          <Text style={[styles.section, { color: colors.textSecondary }]}>{t('search.section.tags', locale)}</Text>
          {tags.length === 0 ? (
            <Text testID="search-no-tags" style={[styles.hint, { color: colors.textSecondary }]}>{t('search.tags.empty', locale)}</Text>
          ) : (
            <View style={styles.tags}>
              {tags.map(({ tag, count }) => {
                const active = query.split(/\s+/).includes(`#${tag}`);
                return (
                  <View key={tag} style={[styles.tagRow, { borderColor: colors.gridLine }]}>
                    <ActionButton label={`#${tag} · ${count}`} accessibilityLabel={`${t(active ? 'search.filter.remove' : 'search.filter.by', locale)} #${tag} (${unit('card', count, locale)})`}
                      pressed={active} onPress={() => toggleTag(tag)} />
                    <ActionButton label={t('search.tag.rename', locale)} accessibilityLabel={t('search.tag.rename.accessibilityLabel', locale, { tag })} onPress={() => { setNewName(tag); setPending({ kind: 'rename', tag, count }); }} />
                    <ActionButton label={t('search.tag.remove', locale)} accessibilityLabel={t('search.tag.remove.accessibilityLabel', locale, { tag })} onPress={() => setPending({ kind: 'remove', tag, count })} />
                  </View>
                );
              })}
            </View>
          )}

          {pending ? (
            <View testID="tag-confirmation" style={[styles.confirm, { borderColor: colors.danger, backgroundColor: colors.surface }]}>
              <Text style={[styles.body, { color: colors.textPrimary }]}>
                {pending.kind === 'rename'
                  ? t('search.tag.rename.body', locale, { tag: pending.tag, count: unit('card', pending.count, locale) })
                  : t('search.tag.remove.body', locale, { tag: pending.tag, count: unit('card', pending.count, locale) })}
              </Text>
              {pending.kind === 'rename' ? <TextField label={t('search.tag.newName.label', locale)} value={newName} onChangeText={setNewName} placeholder={t('search.tag.newName.placeholder', locale)} testID="tag-rename-input" /> : null}
              <View style={styles.row}>
                <ActionButton label={pending.kind === 'rename' ? t('search.tag.rename', locale) : t('search.tag.remove.confirm', locale)} tone="primary"
                  accessibilityLabel={pending.kind === 'rename' ? t('search.tag.rename.confirm.accessibilityLabel', locale, { tag: pending.tag }) : t('search.tag.remove.confirm.accessibilityLabel', locale, { tag: pending.tag })}
                  onPress={() => void confirm()} />
                <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('search.tag.cancel.accessibilityLabel', locale)} onPress={() => setPending(null)} />
              </View>
            </View>
          ) : null}

          <Text testID="search-count" accessibilityLiveRegion="polite" style={[styles.section, { color: colors.textSecondary }]}>
            {!hasQuery ? t('search.section.results', locale) : unit('resultUpper', results.length, locale)}
          </Text>
          {!hasQuery ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('search.hint.empty', locale)}</Text>
          ) : results.length === 0 ? (
            <Text testID="search-empty" style={[styles.hint, { color: colors.textSecondary }]}>{query.trim() === '' ? t('search.empty.noQuery', locale) : t('search.empty.query', locale, { query: query.trim() })}</Text>
          ) : (
            <View style={styles.results}>
              {results.map((result) => resultCard(result, () => { close(); onGo(result); }, result.cardId))}
            </View>
          )}
        </>
      ) : (
        <>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {t('search.hint.all', locale, { projects })}
          </Text>
          <ActionButton label={t('search.all.button', locale, { projects })} tone="primary" accessibilityLabel={t('search.all.button.accessibilityLabel', locale)} onPress={() => void searchAll()} />
          {global === 'searching' ? (
            <Text testID="search-all-progress" accessibilityLiveRegion="polite" style={[styles.hint, { color: colors.textSecondary }]}>{t('search.all.progress', locale, { projects })}</Text>
          ) : global ? (
            <>
              <Text testID="search-all-count" accessibilityLiveRegion="polite" style={[styles.section, { color: colors.textSecondary }]}>
                {t('search.all.count', locale, {
                  results: unit('resultUpper', global.found.projects.reduce((sum, project) => sum + project.results.length, 0), locale),
                  projects: unit('projectUpper', global.found.projects.length, locale),
                })}
              </Text>
              {global.query !== query.trim() ? (
                <Text testID="search-all-stale" style={[styles.hint, { color: colors.textSecondary }]}>{t('search.all.stale', locale, { query: global.query })}</Text>
              ) : null}
              {global.found.unreadable.map((entry) => (
                <Text key={entry.workspaceId} testID="search-all-unreadable" style={[styles.hint, { color: colors.danger }]}>{t('search.all.unreadable', locale, { name: entry.name, message: entry.message })}</Text>
              ))}
              {global.found.projects.length === 0 ? (
                <Text testID="search-empty" style={[styles.hint, { color: colors.textSecondary }]}>{t('search.empty.query', locale, { query: global.query })}</Text>
              ) : global.found.projects.map((project) => (
                <View key={project.workspaceId} testID={`search-project-${project.workspaceId}`} style={styles.results}>
                  <Text accessibilityRole="header" style={[styles.project, { color: colors.textPrimary }]}>
                    {`${project.name}${project.workspaceId === workspace.id ? t('search.project.current', locale) : ''}`}
                  </Text>
                  {project.results.map((result) => resultCard(result, () => {
                    close();
                    if (project.workspaceId === workspace.id) onGo(result);
                    else props.onGoProject(project.workspaceId, result.cardId);
                  }, `${project.workspaceId}-${result.cardId}`))}
                </View>
              ))}
            </>
          ) : null}
        </>
      )}
    </Dialog>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  hint: { fontSize: 13, lineHeight: 18 },
  section: { fontFamily: mono, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tags: { gap: 6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingBottom: 6, borderBottomWidth: 1 },
  confirm: { borderWidth: 2, padding: 10, gap: 8 },
  body: { fontSize: 14, lineHeight: 20 },
  results: { gap: 8 },
  project: { fontSize: 16, fontWeight: '900', marginTop: 4 },
  result: { borderWidth: 2, padding: 10, gap: 4, alignItems: 'flex-start' },
  resultTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  meta: { fontFamily: mono, fontSize: 11, fontWeight: '700' },
  excerpt: { fontSize: 13, lineHeight: 18 },
});
