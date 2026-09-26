import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Dialog } from '../components/Dialog';
import { ActionButton, TextField } from '../components/controls';

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
    <Dialog visible={visible} title="Nuevo enlace" compact={compact} onClose={close} testID="link-dialog">
      <TextField label="Dirección" value={url} onChangeText={(value) => { setUrl(value); setProblem(null); }} placeholder="https://ejemplo.com" testID="link-url-input"
        onSubmitEditing={() => void create()} />
      <TextField label="Título (opcional)" value={title} onChangeText={setTitle} placeholder="Sin título se usa el dominio" testID="link-title-input"
        onSubmitEditing={() => void create()} />
      {problem ? (
        <Text testID="link-problem" accessibilityLiveRegion="assertive" style={[styles.problem, { color: colors.danger, borderColor: colors.danger }]}>{problem}</Text>
      ) : null}
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Se admiten direcciones web (https://…) y de correo (mailto:…). NoutyNotes no descarga nada de la página: la tarjeta guarda solo la dirección y el título.
      </Text>
      <View style={styles.actions}>
        {/* En una carpeta Android, guardar puede tardar unos segundos: se muestra, y un segundo toque no duplica. */}
        <ActionButton label={busy ? 'Creando…' : 'Crear enlace'} accessibilityLabel="Crear enlace" tone="primary" onPress={() => void create()} />
        <ActionButton label="Cancelar" accessibilityLabel="Cancelar el nuevo enlace" onPress={close} />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  problem: { fontSize: 14, lineHeight: 20, borderWidth: 2, padding: 8 },
  hint: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
