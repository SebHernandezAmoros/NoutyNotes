import { Pressable, StyleSheet } from 'react-native';

export function ConnectorPicker({ onPick }: { readonly onPick: (x: number, y: number) => void }) {
  return <Pressable testID="canvas-background" accessibilityRole="button" accessibilityLabel="Marcar posición del conector"
    style={[StyleSheet.absoluteFill, styles.capture]} onPress={(event) => onPick(event.nativeEvent.locationX, event.nativeEvent.locationY)} />;
}

const styles = StyleSheet.create({ capture: { zIndex: 20 } });
