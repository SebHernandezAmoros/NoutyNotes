// Metro resuelve las imágenes importadas como recursos de la app (número en nativo, objeto en web).
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}

// Sin react-native-svg-transformer, Metro trata un SVG como cualquier otro recurso binario (igual
// que un PNG), no como un componente: es lo que se necesita para leer sus bytes (fase 11a, ADR 0033).
declare module '*.svg' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}
