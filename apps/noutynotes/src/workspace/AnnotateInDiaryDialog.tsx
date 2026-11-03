import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';

export interface AnnotateTarget {
  readonly ref: string;
  readonly name: string;
  readonly kind: 'pdf' | 'txt' | 'markdown';
}

export interface AnnotateSaveInput {
  readonly reflection: string;
  readonly page?: number;
  readonly line?: number;
  readonly section?: string;
}

/**
 * «Documento → Anotar en Diario → Escribir → Guardar» (B9-R4-11, MVP Nivel 2), en un único diálogo
 * compacto que reutiliza `Dialog`/`TextField`/`ActionButton` — nada nuevo a nivel de formulario. La
 * ubicación es manual y por tipo de documento: página (PDF) o línea (TXT) como número positivo,
 * encabezado/sección (Markdown) como texto libre; ninguna promete navegación exacta por sí sola.
 * El guardado vive aquí dentro (no en cada llamador): evita el doble envío (B5) y muestra el mismo
 * mensaje de reintento sin repetir ese estado en Assets y en la tarjeta de documento del Canvas.
 */
export function AnnotateInDiaryDialog({ target, compact, onClose, onSave }: {
  readonly target: AnnotateTarget | null;
  readonly compact: boolean;
  readonly onClose: () => void;
  /** `true`: la anotación se guardó; el diálogo se cierra y limpia su borrador. */
  readonly onSave: (input: AnnotateSaveInput) => Promise<boolean>;
}) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const colors = theme.colors;
  const [reflection, setReflection] = useState('');
  const [location, setLocation] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => { setReflection(''); setLocation(''); setProblem(null); setSaving(false); };
  const close = () => { reset(); onClose(); };
  const save = async () => {
    if (!target || saving) return;
    const trimmed = location.trim();
    let input: AnnotateSaveInput;
    if (target.kind === 'markdown') {
      input = { reflection, ...(trimmed ? { section: trimmed } : {}) };
    } else if (trimmed === '') {
      input = { reflection };
    } else {
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setProblem(t(target.kind === 'pdf' ? 'diary.annotate.invalidPage' : 'diary.annotate.invalidLine', locale));
        return;
      }
      input = target.kind === 'pdf' ? { reflection, page: parsed } : { reflection, line: parsed };
    }
    setSaving(true);
    setProblem(null);
    const ok = await onSave(input);
    if (ok) { reset(); return; }
    setSaving(false);
    setProblem(t('diary.annotate.failed', locale));
  };

  return (
    <Dialog visible={target !== null} title={target ? t('diary.annotate.dialog.title', locale, { name: target.name }) : ''} compact={compact} presentation="centered" onClose={close} testID="diary-annotate-dialog">
      {target ? (
        <View style={{ gap: 10 }}>
          <TextField label={t('diary.annotate.reflection.label', locale)} value={reflection} onChangeText={setReflection}
            placeholder={t('diary.annotate.reflection.placeholder', locale)} multiline testID="diary-annotate-reflection" />
          {target.kind !== 'markdown' ? (
            <TextField
              label={t(target.kind === 'pdf' ? 'diary.annotate.page.label' : 'diary.annotate.line.label', locale)}
              value={location} onChangeText={(value) => { setLocation(value); setProblem(null); }}
              placeholder={t(target.kind === 'pdf' ? 'diary.annotate.page.placeholder' : 'diary.annotate.line.placeholder', locale)}
              testID="diary-annotate-location"
            />
          ) : (
            <TextField label={t('diary.annotate.section.label', locale)} value={location} onChangeText={setLocation}
              placeholder={t('diary.annotate.section.placeholder', locale)} testID="diary-annotate-location" />
          )}
          {problem ? <Text testID="diary-annotate-problem" accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>{problem}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <ActionButton testID="diary-annotate-save" label={t('diary.annotate.save', locale)} tone="primary" disabled={saving} onPress={() => void save()} />
            <ActionButton label={t('trash.cancel', locale)} onPress={close} />
          </View>
        </View>
      ) : null}
    </Dialog>
  );
}
