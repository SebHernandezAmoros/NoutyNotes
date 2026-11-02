import { cardTitleText, richTextInlineText } from '@noutynotes/domain';
import type { CardId, RichTextDocument, Workspace } from '@noutynotes/domain';
import type { EditorialDraft } from '@noutynotes/application';
import { useLocale, useTheme } from '@noutynotes/ui';
import type { Locale } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';

export type DraftCardStatus = 'active' | 'trash' | 'archive' | 'deleted';

/** Dónde está hoy la tarjeta de un borrador (UX7-SAVE): decide si «Recuperar» puede funcionar de
 * verdad o si solo cabe copiar/descartar — nunca se ofrece una acción que no puede ejecutarse. */
export function draftCardStatus(workspace: Workspace, cardId: CardId): DraftCardStatus {
  if (workspace.cards.some((card) => card.id === cardId)) return 'active';
  if (workspace.trash?.some((entry) => entry.card.id === cardId)) return 'trash';
  if (workspace.archive?.some((entry) => entry.card.id === cardId)) return 'archive';
  return 'deleted';
}

/** Texto plano legible de un documento enriquecido (nunca JSON) para la vista previa principal. */
function richTextPreview(body: RichTextDocument): string {
  return body.blocks.map((block) => {
    if (block.type === 'paragraph' || block.type === 'heading') return richTextInlineText(block.content);
    if (block.type === 'list') {
      return block.items.map((item) => `${block.style === 'checklist' ? (item.checked ? '[x] ' : '[ ] ') : '- '}${richTextInlineText(item.content)}`).join('\n');
    }
    return '';
  }).filter((line) => line !== '').join('\n');
}

function sourcePreview(draft: EditorialDraft | undefined): string {
  if (!draft) return '';
  if (draft.source.format === 'rich-text') return richTextPreview(draft.source.value);
  return draft.source.value;
}

function sourceExact(draft: EditorialDraft | undefined): string {
  if (!draft) return '';
  return draft.source.format === 'rich-text' ? JSON.stringify(draft.source.value, null, 2) : draft.source.value;
}

interface DraftEntry {
  readonly cardId: CardId;
  readonly status: DraftCardStatus;
  readonly title: string;
  readonly preview: string;
  readonly exact: string;
  readonly updatedAt: string;
}

function entriesOf(workspace: Workspace, drafts: readonly EditorialDraft[], locale: Locale): readonly DraftEntry[] {
  const cardIds = [...new Set(drafts.map((draft) => draft.key.cardId as CardId))];
  return cardIds.map((cardId) => {
    const status = draftCardStatus(workspace, cardId);
    const titleDraft = drafts.find((draft) => draft.key.cardId === cardId && draft.key.zone === 'title');
    const bodyDraft = drafts.find((draft) => draft.key.cardId === cardId && draft.key.zone === 'body');
    const card = workspace.cards.find((candidate) => candidate.id === cardId)
      ?? workspace.trash?.find((entry) => entry.card.id === cardId)?.card
      ?? workspace.archive?.find((entry) => entry.card.id === cardId)?.card;
    const titleFromDraft = titleDraft?.source.format === 'rich-text' && titleDraft.source.value.blocks.length === 1
      && titleDraft.source.value.blocks[0]?.type === 'paragraph' ? richTextInlineText(titleDraft.source.value.blocks[0].content) : '';
    const title = (card ? cardTitleText(card) : '') || titleFromDraft || t('recovery.untitled', locale);
    const updatedAt = [titleDraft?.updatedAt, bodyDraft?.updatedAt].filter((value): value is string => value !== undefined).sort().at(-1) ?? '';
    return { cardId, status, title, preview: sourcePreview(bodyDraft ?? titleDraft), exact: sourceExact(bodyDraft ?? titleDraft), updatedAt };
  });
}

const STATUS_LABEL: Record<DraftCardStatus, TranslationKey> = {
  active: 'recovery.status.active',
  trash: 'recovery.status.trash',
  archive: 'recovery.status.archive',
  deleted: 'recovery.status.deleted',
};

interface RecoveryCenterProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly drafts: readonly EditorialDraft[];
  readonly problem: string | null;
  readonly saveProblem: string | null;
  readonly saveProblemKind: 'conflict' | 'reselect' | 'retry' | null;
  readonly onRetrySave: () => void;
  readonly onRecoverExternal: () => void;
  readonly onReconnectFolder: () => void;
  readonly onReselectFolder: () => void;
  readonly onRecover: (cardId: CardId) => void;
  readonly onDiscard: (cardId: CardId) => void;
  readonly onClose: () => void;
}

/**
 * Centro de recuperación (UX7-SAVE): separa los incidentes de borradores del lienzo. Nunca muestra
 * JSON crudo como contenido principal (solo bajo «Ver fuente exacta», para copiar); nunca ofrece
 * «Recuperar» cuando no puede funcionar — la persona usuaria ve de inmediato por qué, sin intentarlo.
 */
export function RecoveryCenter({ visible, compact, workspace, drafts, problem, saveProblem, saveProblemKind, onRetrySave, onRecoverExternal, onReconnectFolder, onReselectFolder, onRecover, onDiscard, onClose }: RecoveryCenterProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [confirming, setConfirming] = useState<CardId | null>(null);
  const [showingExact, setShowingExact] = useState<CardId | null>(null);
  const entries = entriesOf(workspace, drafts, locale);
  const close = () => { setConfirming(null); setShowingExact(null); onClose(); };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* portapapeles no disponible; el texto sigue visible para copiarlo a mano */ }
  };

  return (
    <Dialog visible={visible} title={t('recovery.title', locale)} compact={compact} onClose={close} testID="recovery-center">
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        {t('recovery.intro', locale)}
      </Text>
      {problem ? <Text testID="recovery-problem" accessibilityRole="alert" style={[styles.warning, { color: colors.danger }]}>{problem}</Text> : null}
      {saveProblem ? (
        <View testID="recovery-save-problem" style={[styles.saveProblem, { borderColor: colors.danger }]}>
          <Text accessibilityRole="alert" style={[styles.warning, { color: colors.danger }]}>{saveProblem}</Text>
          <View style={styles.actions}>
            {saveProblemKind === 'conflict' ? (
              <ActionButton label={t('recovery.reload', locale)} accessibilityLabel={t('recovery.reloadLabel', locale)} tone="primary" onPress={onRecoverExternal} />
            ) : null}
            {saveProblemKind === 'retry' ? (
              <ActionButton label={t('recovery.retry', locale)} accessibilityLabel={t('recovery.retryLabel', locale)} tone="primary" onPress={onRetrySave} />
            ) : null}
            {saveProblemKind === 'retry' || saveProblemKind === 'reselect' ? (
              <>
                <ActionButton label={t('recovery.reconnect', locale)} accessibilityLabel={t('recovery.reconnectLabel', locale)} onPress={onReconnectFolder} />
                <ActionButton label={t('recovery.chooseFolder', locale)} accessibilityLabel={t('recovery.chooseFolder', locale)} onPress={onReselectFolder} />
              </>
            ) : null}
          </View>
        </View>
      ) : null}
      {entries.length === 0 ? (
        <Text testID="recovery-empty" style={[styles.empty, { color: colors.textSecondary, borderColor: colors.gridLine }]}>
          {t('recovery.empty', locale)}
        </Text>
      ) : entries.map((entry) => (
        <View key={entry.cardId} testID={`recovery-item-${entry.cardId}`} style={[styles.item, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{entry.title}</Text>
          <Text testID={`recovery-status-${entry.cardId}`} style={[styles.status, { color: entry.status === 'active' ? colors.textSecondary : colors.danger }]}>
            {t(STATUS_LABEL[entry.status], locale)}
          </Text>
          {entry.preview ? (
            <Text testID={`recovery-preview-${entry.cardId}`} numberOfLines={4} style={[styles.preview, { color: colors.textPrimary, borderColor: colors.gridLine }]}>
              {entry.preview}
            </Text>
          ) : null}
          <ActionButton
            label={t(showingExact === entry.cardId ? 'recovery.hideExact' : 'recovery.showExact', locale)}
            accessibilityLabel={t(showingExact === entry.cardId ? 'recovery.hideExactNamed' : 'recovery.showExactNamed', locale, { title: entry.title })}
            onPress={() => setShowingExact((current) => (current === entry.cardId ? null : entry.cardId))}
          />
          {showingExact === entry.cardId ? (
            <Text testID={`recovery-exact-${entry.cardId}`} selectable numberOfLines={8} style={[styles.exact, { color: colors.textPrimary, borderColor: colors.gridLine }]}>
              {entry.exact}
            </Text>
          ) : null}
          {confirming === entry.cardId ? (
            <View testID={`recovery-discard-confirm-${entry.cardId}`} style={[styles.confirm, { borderColor: colors.danger }]}>
              <Text accessibilityRole="alert" style={[styles.warning, { color: colors.danger }]}>
                {t('recovery.discardWarning', locale)}
              </Text>
              <View style={styles.actions}>
                <ActionButton label={t('recovery.discard', locale)} accessibilityLabel={t('recovery.confirmDiscardNamed', locale, { title: entry.title })}
                  onPress={() => { setConfirming(null); onDiscard(entry.cardId); }} />
                <ActionButton label={t('recovery.cancel', locale)} accessibilityLabel={t('recovery.cancelDiscard', locale)} onPress={() => setConfirming(null)} />
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              {entry.status === 'active' ? (
                <ActionButton label={t('recovery.recover', locale)} accessibilityLabel={t('recovery.recoverNamed', locale, { title: entry.title })} tone="primary" onPress={() => onRecover(entry.cardId)} />
              ) : null}
              <ActionButton label={t('recovery.copy', locale)} accessibilityLabel={t('recovery.copyNamed', locale, { title: entry.title })} onPress={() => void copy(entry.exact)} />
              <ActionButton label={t('recovery.discard', locale)} accessibilityLabel={t('recovery.discardNamed', locale, { title: entry.title })} onPress={() => setConfirming(entry.cardId)} />
            </View>
          )}
        </View>
      ))}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20 },
  empty: { fontSize: 15, borderWidth: 2, borderStyle: 'dashed', padding: 16 },
  item: { borderWidth: 2, padding: 12, gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  status: { fontSize: 13, lineHeight: 18 },
  preview: { fontSize: 14, lineHeight: 19, borderWidth: 1, padding: 8 },
  exact: { fontFamily: 'monospace', fontSize: 11, lineHeight: 15, borderWidth: 1, padding: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirm: { borderWidth: 2, padding: 10, gap: 8 },
  warning: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  saveProblem: { borderWidth: 2, padding: 10, gap: 8 },
});
