import { assertValid, importTemplate } from '@noutynotes/domain';
import type { Template } from '@noutynotes/domain';

import gdd from '../../assets/templates/gdd.json';
import research from '../../assets/templates/research.json';
import storyboard from '../../assets/templates/storyboard.json';

export interface BuiltInTemplate {
  readonly id: string;
  readonly template: Template;
}

/**
 * Las tres plantillas incorporadas (fase 11a, ADR 0033): GDD, Storyboard e Investigación, ya modeladas
 * en el dominio desde la fase 4. Se validan al cargar el módulo: un manifiesto propio mal formado es un
 * defecto de la app, no una entrada de la persona usuaria, así que falla alto y pronto, no en silencio.
 */
export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  { id: 'gdd', template: assertValid(importTemplate(gdd)) },
  { id: 'storyboard', template: assertValid(importTemplate(storyboard)) },
  { id: 'research', template: assertValid(importTemplate(research)) },
];
