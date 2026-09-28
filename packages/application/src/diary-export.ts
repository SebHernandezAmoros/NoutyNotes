/**
 * Exportación del Diario (ADR 0037): documento Markdown de un día o rango, no un ZIP de workspace.
 * Texto completo, como «Imprimir» (ADR 0031): es una exportación explícita, no un extracto.
 */
import type { Workspace } from '@noutynotes/domain';

import { type DailyLogRangeResult, type RangeLogItem, dailyLogRange } from './daily-log';

export type DiaryExportResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

const verb: Readonly<Record<RangeLogItem['kind'], string>> = { entry: 'Entrada', created: 'Creada', archived: 'Archivada' };

function line(workspace: Workspace, item: RangeLogItem): readonly string[] {
  const typeLabel = workspace.cardTypes.find((type) => type.id === item.card.typeId)?.label ?? 'Tarjeta';
  const title = item.card.title ?? 'Sin título';
  const out = [`- ${item.time} · ${verb[item.kind]} · ${typeLabel.toUpperCase()} · ${title}`];
  const tags = item.card.tags ?? [];
  if (tags.length > 0) out.push(`  Etiquetas: ${tags.map((tag) => `#${tag}`).join(' ')}`);
  if (item.kind === 'entry' && item.card.content && item.card.content.trim() !== '') out.push('', item.card.content.trim(), '');
  return out;
}

export function diaryExportText(workspace: Workspace, from: string, to: string, offsetMinutes: number): DiaryExportResult {
  const range: DailyLogRangeResult = dailyLogRange(workspace, from, to, offsetMinutes);
  if (!range.ok) return range;
  const lines: string[] = [`# Diario — ${from === to ? from : `${from} a ${to}`}`, ''];
  if (range.items.length === 0) {
    lines.push('Sin datos en este rango.');
  } else {
    let currentDay = '';
    for (const item of range.items) {
      if (item.day !== currentDay) {
        currentDay = item.day;
        lines.push(`## ${currentDay}`, '');
      }
      lines.push(...line(workspace, item));
    }
  }
  return { ok: true, text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}
