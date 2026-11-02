import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import type { PrintEntry } from '@noutynotes/application';
import { ReadingOrderDialog } from './ReadingOrderControl';
import { readingPreviewText, reconcileReadingOrder } from './readingOrder';
import type { PrintOptions } from './printHtml';

export function PrintOptionsDialog({ visible, boardTitle, entries, images, missing, loading, compact, onClose, onContinue }: {
  readonly visible: boolean;
  readonly boardTitle: string;
  readonly entries: readonly PrintEntry[];
  /** B9-R4-01: mismo mapa de URIs ya resueltas que recibe Presentar (`previews.refs`), para que el
   * orden de lectura también muestre miniatura aquí — no hace falta adelantar ninguna resolución. */
  readonly images?: ReadonlyMap<string, string>;
  readonly missing: number;
  readonly loading: number;
  readonly compact: boolean;
  readonly onClose: () => void;
  readonly onContinue: (options: Pick<PrintOptions, 'paper' | 'orientation' | 'style'> & { readonly orderIds: readonly string[] }) => void;
}) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const [paper, setPaper] = useState<'A4' | 'Letter'>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [style, setStyle] = useState<'report' | 'visual'>('report');
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [orderOpen, setOrderOpen] = useState(false);
  return <Dialog visible={visible} title={t('print.title', locale)} compact={compact} presentation="centered" onClose={onClose} testID="print-options">
    <Text style={{ color: theme.colors.textPrimary }}>{t('print.scope', locale, { board: boardTitle })}</Text>
    <Text accessibilityRole="header" style={[styles.label, { color: theme.colors.textPrimary }]}>{t('print.paper', locale)}</Text>
    <View style={styles.segmented}>
      <ActionButton testID="print-paper-a4" label="A4" pressed={paper === 'A4'} onPress={() => setPaper('A4')} />
      <ActionButton testID="print-paper-letter" label="Letter" pressed={paper === 'Letter'} onPress={() => setPaper('Letter')} />
    </View>
    <Text accessibilityRole="header" style={[styles.label, { color: theme.colors.textPrimary }]}>{t('print.orientation', locale)}</Text>
    <View style={styles.segmented}>
      <ActionButton testID="print-portrait" label={t('print.portrait', locale)} pressed={orientation === 'portrait'} onPress={() => setOrientation('portrait')} />
      <ActionButton testID="print-landscape" label={t('print.landscape', locale)} pressed={orientation === 'landscape'} onPress={() => setOrientation('landscape')} />
    </View>
    <Text accessibilityRole="header" style={[styles.label, { color: theme.colors.textPrimary }]}>{locale === 'es' ? 'Estilo' : 'Style'}</Text>
    <View style={styles.segmented}>
      <ActionButton label={locale === 'es' ? 'Informe' : 'Report'} pressed={style === 'report'} onPress={() => setStyle('report')} />
      <ActionButton label={locale === 'es' ? 'Visual' : 'Visual'} pressed={style === 'visual'} onPress={() => setStyle('visual')} />
    </View>
    <ActionButton testID="print-organize" label={locale === 'es' ? 'Ordenar…' : 'Reorder…'} onPress={() => setOrderOpen(true)} />
    {/* B9-R4-01: el mismo mapa de URIs ya resueltas que recibe Presentar (`images`, opcional) también
        identifica aquí cada fila con imagen, sin adelantar ninguna resolución nueva. */}
    <ReadingOrderDialog testID="print-reading-order" visible={orderOpen} compact={compact} onClose={() => setOrderOpen(false)}
      items={entries.map((entry) => {
        const thumbRef = images ? entry.imageRefs.find((ref) => images.has(ref)) : undefined;
        const thumbnailUri = thumbRef ? images?.get(thumbRef) : undefined;
        return { id: entry.id, title: entry.title, typeLabel: entry.typeLabel, excerpt: readingPreviewText(entry), ...(thumbnailUri ? { thumbnailUri } : {}) };
      })}
      order={orderIds} onChange={setOrderIds} />
    {missing > 0 ? <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>{t(missing === 1 ? 'print.missingOne' : 'print.missingCount', locale, { count: String(missing) })}</Text> : null}
    {loading > 0 ? <Text style={{ color: theme.colors.textSecondary }}>{t(loading === 1 ? 'print.loadingOne' : 'print.loadingCount', locale, { count: String(loading) })}</Text> : null}
    <ActionButton testID="print-continue" tone="primary" label={t('print.continue', locale)} onPress={() => onContinue({ paper, orientation, style, orderIds: reconcileReadingOrder(orderIds, entries.map((entry) => entry.id)) })} />
  </Dialog>;
}

const styles = StyleSheet.create({ segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 }, label: { fontWeight: '700' } });
