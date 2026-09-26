// Metro resuelve las imágenes importadas como recursos de la app (número en nativo, objeto en web).
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}
