import { useLocale, useTheme } from '@noutynotes/ui';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text } from 'react-native';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';

export type ImageViewerState = { readonly label: string } & ({ readonly status: 'loading' | 'error' } | { readonly status: 'ready'; readonly uri: string });
export function ImageViewer({ state, onClose }: { readonly state: ImageViewerState | null; readonly onClose: () => void }) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const visible = state !== null;
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [visible, onClose]);
  return <Dialog visible={state !== null} title={state?.label || t('content.imageViewer', locale)} compact={false} presentation="centered" onClose={onClose} testID="image-viewer">
    {state?.status === 'ready' && Platform.OS === 'web' ? <ImageViewport key={state.uri} uri={state.uri} label={state.label} />
      : <Text style={{ color: theme.colors.textPrimary }} accessibilityRole={state?.status === 'error' ? 'alert' : undefined}>{t(state?.status === 'error' ? 'content.missing' : 'content.loading', locale)}</Text>}
  </Dialog>;
}
function ImageViewport({ uri, label }: { readonly uri: string; readonly label: string }) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const [scale, setScale] = useState<number | null>(null);
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const points = useRef(new Map<number, { x: number; y: number }>());
  const ratio = () => scale ?? ((image.current?.width ?? natural.width) / natural.width);
  const zoom = (value: number) => setScale(Math.min(4, Math.max(0.05, value)));
  // Reserva cabecera y controles también en orientación horizontal; no impone alto vacío a imágenes pequeñas.
  const heightLimit = 'max(64px, min(60dvh, calc(100dvh - 240px)))';
  const style = { minWidth: 44, minHeight: 44, background: theme.colors.surface, color: theme.colors.textPrimary, border: `1px solid ${theme.colors.border}` };
  return <div onWheel={(event) => event.stopPropagation()}>
    <div role="toolbar" aria-label={t('content.imageViewer', locale)} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <button style={style} aria-label={t('content.zoomOut', locale)} onClick={() => zoom(ratio() / 1.25)}>−</button>
      <button style={style} aria-label={t('content.zoomIn', locale)} onClick={() => zoom(ratio() * 1.25)}>+</button>
      <button style={style} onClick={() => setScale(1)}>100%</button>
      <button style={style} onClick={() => { setScale(null); viewport.current?.scrollTo(0, 0); }}>{t('content.fit', locale)}</button>
      <span role="status" style={{ color: theme.colors.textPrimary }}>{scale === null ? t('content.fit', locale) : `${Math.round(scale * 100)}%`}</span>
    </div>
    <div ref={viewport} tabIndex={0} role="region" aria-label={t('content.imageViewer', locale)}
      style={{ overflow: 'auto', overscrollBehavior: 'contain', maxWidth: '100%', maxHeight: heightLimit, background: theme.colors.background, touchAction: 'none' }}
      onKeyDown={(event) => {
        if (['+', '-', '0'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (event.key === '0') setScale(null); else zoom(ratio() * (event.key === '+' ? 1.25 : 0.8)); }
      }}
      onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); points.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); }}
      onPointerMove={(event) => {
        const previous = points.current.get(event.pointerId);
        if (!previous) return;
        event.stopPropagation();
        const other = [...points.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
        if (other) {
          const before = Math.hypot(previous.x - other.x, previous.y - other.y);
          const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
          if (before > 0) zoom(ratio() * after / before);
        } else { event.currentTarget.scrollLeft -= event.clientX - previous.x; event.currentTarget.scrollTop -= event.clientY - previous.y; }
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }}
      onPointerUp={(event) => points.current.delete(event.pointerId)} onPointerCancel={(event) => points.current.delete(event.pointerId)}>
      <img ref={image} src={uri} alt={label} draggable={false} onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        style={scale === null ? { display: 'block', margin: 'auto', maxWidth: '100%', maxHeight: heightLimit, width: 'auto', height: 'auto', objectFit: 'contain' }
          : { display: 'block', margin: 'auto', width: natural.width * scale, height: natural.height * scale, maxWidth: 'none' }} />
    </div>
  </div>;
}
