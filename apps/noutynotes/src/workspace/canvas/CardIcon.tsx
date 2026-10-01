import type { CardIconName } from '@noutynotes/domain';
import { View } from 'react-native';

import { AppIcon } from '../../components/AppIcon';

/**
 * Icono de la ficha minimizada (ADR 0016), dibujado con vistas: igual en web y Android, sin fuentes de
 * iconos ni emoji. Nota: hoja con renglones y esquina doblada. Imagen: marco con sol y montaña.
 */
export function CardIcon({ kind, testID }: { readonly kind: CardIconName; readonly testID?: string }) {
  return <View {...(testID ? { testID } : {})} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><AppIcon name={kind} size={24} /></View>;
}
