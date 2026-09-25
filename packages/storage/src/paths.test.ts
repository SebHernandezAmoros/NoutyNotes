import { describe, expect, it } from 'vitest';

import { problems, valueOf } from './__fixtures__/helpers';
import { assetRefToMarkdownLink, markdownLinkToAssetRef, validatePortablePath } from './paths';

describe('rutas portables', () => {
  it.each([
    'cards/idea-a.md', '.nouty/workspace.yaml', 'README.md', 'assets/Informe final.pdf',
    'assets/ñandú.webp', 'assets/images/hero-1.png', 'a/b/c/d.txt',
  ])('acepta %s sin modificarla', (path) => {
    expect(validatePortablePath(path)).toEqual({ ok: true, value: path });
  });

  it.each([
    ['vacía', ''],
    ['absoluta', '/cards/a.md'],
    ['unidad Windows', 'C:/cards/a.md'],
    ['unidad relativa Windows', 'c:cards'],
    ['ruta UNC', '//server/share'],
    ['barra invertida', 'cards\\a.md'],
    ['traversal', '../secret.md'],
    ['traversal intermedio', 'cards/../../x.md'],
    ['segmento actual', './cards/a.md'],
    ['segmento vacío', 'cards//a.md'],
    ['barra final', 'cards/'],
    ['punto final', 'cards/a.'],
    ['espacio final', 'cards/a /b.md'],
    ['espacio inicial', ' cards/a.md'],
    ['menor que', 'cards/a<b.md'],
    ['dos puntos', 'cards/a:b.md'],
    ['comillas', 'cards/a"b.md'],
    ['barra vertical', 'cards/a|b.md'],
    ['interrogación', 'cards/a?.md'],
    ['asterisco', 'cards/a*.md'],
    ['carácter de control', 'cards/a\u0001.md'],
    ['dispositivo CON', 'CON'],
    ['dispositivo con extensión', 'assets/nul.png'],
    ['dispositivo en minúsculas', 'boards/com1.md'],
    ['dispositivo LPT9', 'lpt9'],
    ['segmento demasiado largo', `assets/${'a'.repeat(256)}`],
    ['ruta demasiado larga', `${'a/'.repeat(600)}x`],
    ['no texto', 12],
  ])('rechaza %s', (_case, path) => {
    expect(problems(validatePortablePath(path))).toEqual(['invalid-path@path']);
  });
});

// Unidades UTF-16 construidas por código: un sustituto aislado no se puede escribir literalmente en un archivo UTF-8.
const high = String.fromCharCode(0xd800);
const low = String.fromCharCode(0xdc00);
const parrot = String.fromCharCode(0xd83e, 0xdd9c);

describe('regresión: sustitutos UTF-16 aislados (cierre de fase 5)', () => {
  it.each([
    ['sustituto alto aislado', `assets/a${high}.png`],
    ['sustituto bajo aislado', `assets/a${low}.png`],
    ['par invertido', `assets/a${low}${high}.png`],
    ['sustituto alto al final', `assets/a${high}`],
  ])('una ruta con %s no es portable', (_case, path) => {
    expect(problems(validatePortablePath(path))).toEqual(['invalid-path@path']);
  });

  it('un par sustituto completo sigue siendo válido y hace round-trip como enlace', () => {
    const ref = `assets/${parrot}.png`;
    expect(validatePortablePath(ref)).toEqual({ ok: true, value: ref });
    const link = valueOf(assetRefToMarkdownLink('cards/a.md', ref));
    expect(link).toBe('../assets/%F0%9F%A6%9C.png');
    expect(markdownLinkToAssetRef('cards/a.md', link)).toEqual({ ok: true, value: ref });
  });

  it('assetRefToMarkdownLink devuelve incidencias en lugar de lanzar URIError', () => {
    expect(() => assetRefToMarkdownLink('cards/a.md', `assets/a${high}.png`)).not.toThrow();
    expect(problems(assetRefToMarkdownLink('cards/a.md', `assets/a${high}.png`))).toEqual(['invalid-path@assetRef']);
    expect(problems(assetRefToMarkdownLink(`cards/b${low}.md`, 'assets/x.png'))).toEqual(['invalid-path@fromFile']);
  });

  it('markdownLinkToAssetRef no produce referencias con sustitutos aislados, codificados o no', () => {
    expect(problems(markdownLinkToAssetRef('cards/a.md', `../assets/a${high}.png`))).toEqual(['invalid-link@href']);
    expect(problems(markdownLinkToAssetRef('cards/a.md', '../assets/a%ED%A0%80.png'))).toEqual(['invalid-link@href']);
    expect(problems(markdownLinkToAssetRef(`cards/b${high}.md`, '../assets/x.png'))).toEqual(['invalid-path@fromFile']);
  });
});

describe('enlaces Markdown hacia assets', () => {
  it.each([
    ['cards/idea-a.md', 'assets/images/hero.png', '../assets/images/hero.png'],
    ['README.md', 'assets/images/hero.png', 'assets/images/hero.png'],
    ['boards/overview.md', 'boards/diagram.svg', 'diagram.svg'],
    ['cards/idea-a.md', 'assets/images/hero one.png', '../assets/images/hero%20one.png'],
    ['cards/idea-a.md', 'assets/ñandú 🦜.webp', '../assets/%C3%B1and%C3%BA%20%F0%9F%A6%9C.webp'],
    ['cards/idea-a.md', 'assets/a#b%c(d).png', '../assets/a%23b%25c%28d%29.png'],
    ['a/b/c/doc.md', 'a/x/y.png', '../../x/y.png'],
  ])('desde %s, %s → %s', (from, ref, link) => {
    expect(assetRefToMarkdownLink(from, ref)).toEqual({ ok: true, value: link });
    expect(markdownLinkToAssetRef(from, link)).toEqual({ ok: true, value: ref });
  });

  it('interpreta segmentos "." y ".." dentro del workspace y caracteres sin codificar', () => {
    expect(valueOf(markdownLinkToAssetRef('boards/overview.md', './img.png'))).toBe('boards/img.png');
    expect(valueOf(markdownLinkToAssetRef('cards/a.md', '../assets/./x/../hero.png'))).toBe('assets/hero.png');
    expect(valueOf(markdownLinkToAssetRef('cards/a.md', '../assets/ñandú.png'))).toBe('assets/ñandú.png');
  });

  it.each([
    ['URL remota', 'https://example.com/a.png'],
    ['esquema data', 'data:image/png;base64,AAAA'],
    ['mailto', 'mailto:hola@example.com'],
    ['protocolo relativo', '//example.com/a.png'],
    ['absoluta', '/assets/a.png'],
    ['unidad Windows', 'C:/assets/a.png'],
    ['sale del workspace', '../../x.png'],
    ['escape inválido', '../assets/%ZZ.png'],
    ['barra codificada', '../assets/a%2Fb.png'],
    ['barra invertida codificada', '../assets/a%5Cb.png'],
    ['barra invertida', '..\\assets\\a.png'],
    ['fragmento', '../assets/a.png#top'],
    ['consulta', '../assets/a.png?v=1'],
    ['vacío', ''],
    ['solo directorio', '../assets/'],
    ['no portable', '../assets/a%3F.png'],
  ])('rechaza el enlace %s', (_case, href) => {
    expect(problems(markdownLinkToAssetRef('cards/idea-a.md', href))).toEqual(['invalid-link@href']);
  });

  it('rechaza orígenes o referencias no portables', () => {
    expect(problems(assetRefToMarkdownLink('../x.md', 'assets/a.png'))).toEqual(['invalid-path@fromFile']);
    expect(problems(assetRefToMarkdownLink('cards/a.md', 'assets/a?.png'))).toEqual(['invalid-path@assetRef']);
    expect(problems(assetRefToMarkdownLink('cards/a.md', '../a.png'))).toEqual(['invalid-path@assetRef']);
    expect(problems(markdownLinkToAssetRef('C:/x.md', 'a.png'))).toEqual(['invalid-path@fromFile']);
  });
});
