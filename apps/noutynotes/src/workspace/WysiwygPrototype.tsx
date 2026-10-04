/**
 * Prototipo técnico aislado (UX7.3A, pendiente de ADR): NO se usa en el editor real todavía. Solo
 * comprueba, con la biblioteca instalada, que el round-trip Markdown → visual → Markdown no pierde
 * contenido y que la sintaxis cruda no se ve en pantalla mientras se escribe.
 */
import { EnrichedMarkdownTextInput } from 'react-native-enriched-markdown';
import type { EnrichedMarkdownTextInputInstance } from 'react-native-enriched-markdown';
import { useRef, useState } from 'react';
import { Button, Text, View } from 'react-native';

export function WysiwygPrototype() {
  const ref = useRef<EnrichedMarkdownTextInputInstance>(null);
  const [markdown, setMarkdown] = useState('');
  const [readBack, setReadBack] = useState('');

  return (
    <View testID="wysiwyg-prototype" style={{ padding: 16, gap: 8 }}>
      <EnrichedMarkdownTextInput
        ref={ref}
        testID="wysiwyg-input"
        defaultValue={'Texto **negrita** y *cursiva*.\n\n- uno\n- dos\n\n- [ ] pendiente\n- [x] hecho'}
        markdownShortcuts
        multiline
        style={{ minHeight: 120, borderWidth: 1, borderColor: '#999', padding: 8 }}
        onChangeMarkdown={setMarkdown}
      />
      <Text testID="wysiwyg-markdown-live">{markdown}</Text>
      <Button title="Leer Markdown (ref.getMarkdown)" onPress={() => { void ref.current?.getMarkdown().then(setReadBack); }} />
      <Text testID="wysiwyg-markdown-readback">{readBack}</Text>
      <Button title="Negrita" onPress={() => ref.current?.toggleBold()} />
      <Button title="Cursiva" onPress={() => ref.current?.toggleItalic()} />
      <Button title="Lista" onPress={() => ref.current?.toggleUnorderedList()} />
    </View>
  );
}
