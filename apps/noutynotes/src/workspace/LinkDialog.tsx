import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Dialog } from '../components/Dialog';
import { ActionButton, TextField } from '../components/controls';
import { t } from '../i18n';

interface LinkDialogProps {
  readonly visible: boolean;
  readonly compact: boolean;
  /** Crea la tarjeta; devuelve el motivo si no se pudo (URL no admitida, fallo al guardar…). */
  readonly onCreate: (url: string, title: string) => Promise<string | null>;
  readonly onClose: () => void;
}

/**
 * Nueva tarjeta de enlace (ADR 0020): dirección obligatoria y título opcional (sin él, el dominio).
 * No se consulta la web: ni vista previa ni metadatos.
 */
export function LinkDialog({ visible, compact, onCreate, onClose }: LinkDialogProps) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const colors = theme.colors;
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setUrl('');
    setTitle('');
    setProblem(null);
    onClose();
  };
  const create = async () => {
    if (busy) return;
    setBusy(true);
    const failure = await onCreate(url, title);
    setBusy(false);
    if (failure === null) close();
    else setProblem(failure);
  };

  return (
    <Dialog visible={visible} title={t('link.dialog.title', locale)} compact={compact} onClose={close} testID="link-dialog">
      <TextField label={t('link.url.label', locale)} value={url} onChangeText={(value) => { setUrl(value); setProblem(null); }} placeholder={t('link.url.placeholder', locale)} testID="link-url-input"
        onSubmitEditing={() => void create()} />
      <TextField label={t('link.title.label', locale)} value={title} onChangeText={setTitle} placeholder={t('link.title.placeholder', locale)} testID="link-title-input"
        onSubmitEditing={() => void create()} />
      {problem ? (
        <Text testID="link-problem" accessibilityLiveRegion="assertive" style={[styles.problem, { color: colors.danger, borderColor: colors.danger }]}>{problem}</Text>
      ) : null}
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        {t('link.hint', locale)}
      </Text>
      <View style={styles.actions}>
        {/* En una carpeta Android, guardar puede tardar unos segundos: se muestra, y un segundo toque no duplica. */}
        <ActionButton label={busy ? t('link.create.creating', locale) : t('link.create', locale)} accessibilityLabel={t('link.create', locale)} tone="primary" onPress={() => void create()} />
        <ActionButton label={t('trash.cancel', locale)} accessibilityLabel={t('link.cancel.accessibilityLabel', locale)} onPress={close} />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  problem: { fontSize: 14, lineHeight: 20, borderWidth: 2, padding: 8 },
  hint: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
