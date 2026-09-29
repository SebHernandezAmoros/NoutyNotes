import { assetsOf, createWorkspaceFromBuiltInTemplate, workspaceIdFromName } from '@noutynotes/application';
import type { WorkspaceStorage } from '@noutynotes/application';
import type { AssetRef } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import type { Locale } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import { describeFailure } from '../session/messages';
import { BUILT_IN_TEMPLATES } from '../session/builtInTemplates';
import { readTemplateAsset } from '../session/templateAssets';

interface TemplatePickerProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly storage: WorkspaceStorage;
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly onCreated: (workspaceId: string) => void;
}

/**
 * Selector de plantillas incorporadas (fase 11a, ADR 0033): listar, previsualizar el nombre, la
 * descripción y el README, y crear un espacio a partir de una, con sus assets copiados. Importar,
 * exportar y duplicar una plantilla propia quedan para 11b (fuera de esta subfase).
 */
export function TemplatePicker({ visible, compact, storage, locale, onClose, onCreated }: TemplatePickerProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [selectedId, setSelectedId] = useState<string>(BUILT_IN_TEMPLATES[0]?.id ?? '');
  const [draftName, setDraftName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = BUILT_IN_TEMPLATES.find((entry) => entry.id === selectedId) ?? BUILT_IN_TEMPLATES[0];

  const select = (id: string) => {
    setSelectedId(id);
    setError(null);
  };

  const close = () => {
    if (creating) return;
    setDraftName('');
    setError(null);
    onClose();
  };

  const create = async () => {
    if (creating || !selected) return;
    const assets = assetsOf(storage);
    if (!assets) {
      setError(describeFailure([{ code: 'io-failure', path: 'assets', message: 'Este almacenamiento no admite archivos.' }]));
      return;
    }
    setCreating(true);
    try {
      const refs = selected.template.assets ?? [];
      const assetBytes = new Map<AssetRef, Uint8Array>();
      try {
        for (const ref of refs) assetBytes.set(ref, await readTemplateAsset(ref));
      } catch {
        setError(t('home.template.picker.error.assets', locale));
        return;
      }
      const listed = await storage.list();
      if (!listed.ok) {
        setError(describeFailure(listed.issues));
        return;
      }
      const name = draftName.trim() === '' ? selected.template.template.name : draftName.trim();
      const id = workspaceIdFromName(name, listed.value.map((summary) => summary.id));
      const result = await createWorkspaceFromBuiltInTemplate(storage, assets, selected.template, { workspaceId: id, name, namespace: id }, assetBytes);
      if (!result.ok) {
        setError(describeFailure(result.issues));
        return;
      }
      setDraftName('');
      setError(null);
      onCreated(result.value.id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog visible={visible} title={t('home.template.picker.title', locale)} compact={compact} onClose={close} testID="template-picker">
      <View style={styles.list}>
        {BUILT_IN_TEMPLATES.map(({ id, template }) => (
          <ActionButton
            key={id}
            label={template.template.name}
            accessibilityLabel={t('home.template.picker.select', locale, { name: template.template.name })}
            pressed={id === selectedId}
            onPress={() => select(id)}
            style={styles.templateButton}
          />
        ))}
      </View>
      {selected ? (
        <View style={styles.preview}>
          {selected.template.template.description ? (
            <Text style={[styles.description, { color: colors.textSecondary }]}>{selected.template.template.description}</Text>
          ) : null}
          <Text style={[styles.readme, { color: colors.textPrimary }]}>
            {selected.template.readme?.trim() || t('home.template.picker.readme.empty', locale)}
          </Text>
        </View>
      ) : null}
      <TextField
        label={t('home.template.picker.nameLabel', locale)}
        value={draftName}
        onChangeText={setDraftName}
        placeholder={selected?.template.template.name ?? ''}
        onSubmitEditing={() => void create()}
      />
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.textPrimary, borderColor: colors.border }]}>{error}</Text>
      ) : null}
      <ActionButton
        label={creating ? t('home.template.picker.create.creating', locale) : t('home.template.picker.create', locale)}
        tone="primary"
        disabled={creating || !selected}
        onPress={() => void create()}
      />
    </Dialog>
  );
}

const styles = StyleSheet.create({
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  templateButton: { flexGrow: 1 },
  preview: { gap: 8 },
  description: { fontSize: 14, lineHeight: 20 },
  readme: { fontSize: 14, lineHeight: 21 },
  error: { padding: 12, borderWidth: 1, fontSize: 14, lineHeight: 20 },
});
