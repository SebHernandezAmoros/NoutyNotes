import type { AssetRef, RichTextDocument, Workspace } from '../../packages/domain/src/index';
import { htmlWorkspace } from '../../packages/storage/src/__fixtures__/html-workspace';

export const pdfRef = 'assets/documents/manual.pdf' as AssetRef;
export const fontRef = 'assets/fonts/portable.ttf' as AssetRef;
export const block8Document: RichTextDocument = { schemaVersion: 4, blocks: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Antes del PDF', marks: ['bold'] }] },
  { type: 'pdf', assetRef: pdfRef, label: 'Manual <local>' },
  { type: 'paragraph', content: [{ type: 'text', text: 'Después del PDF' }] },
  { type: 'retired-image', alt: 'Mapa retirado' },
] };
export function block8Workspace(): Workspace {
  const source = htmlWorkspace();
  return { ...source, cards: source.cards.map((card, i) => i === 0 ? { ...card, assetRefs: [pdfRef], contentDocument: block8Document,
    noteBackground: 'paper', noteFont: { kind: 'asset', assetRef: fontRef } } : card) };
}

/** Small, self-contained two-page PDF, with correct offsets and a standard built-in font. */
export function block8PdfBytes(): Uint8Array {
  const stream = (text: string) => `BT /F1 24 Tf 50 700 Td (${text}) Tj ET`;
  const first = stream('NoutyNotes - page 1');
  const second = stream('NoutyNotes - page 2');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
