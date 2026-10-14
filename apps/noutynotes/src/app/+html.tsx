import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Html({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>NoutyNotes · Un lugar para tus ideas</title>
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --nouty-scroll-thumb: #34362f;
            --nouty-scroll-track: transparent;
          }
          * {
            scrollbar-width: thin;
            scrollbar-color: var(--nouty-scroll-thumb) var(--nouty-scroll-track);
          }
          *::-webkit-scrollbar {
            width: 10px;
            height: 10px;
          }
          *::-webkit-scrollbar-track {
            background: var(--nouty-scroll-track);
          }
          *::-webkit-scrollbar-thumb {
            background: var(--nouty-scroll-thumb);
            border: 2px solid transparent;
            background-clip: content-box;
          }
          *::-webkit-scrollbar-corner {
            background: var(--nouty-scroll-track);
          }
        ` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
