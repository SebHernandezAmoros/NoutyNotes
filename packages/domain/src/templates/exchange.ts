import type { ValidationResult } from '../errors';
import type { Template } from './template';
import { validateTemplate } from './template';
import { failure, issue, resultOf } from '../errors';
import { copyTemplateData } from './data';

/** Frontera de intercambio en memoria. No lee archivos ni interpreta YAML o código. */
export function importTemplate(input: unknown): ValidationResult<Template> {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); }
    catch { return failure([issue('invalid-value', 'template', 'El texto no es JSON válido.')]); }
  }
  const checked = validateTemplate(data);
  return checked.ok ? resultOf(copyTemplateData(checked.value), []) : failure(checked.issues);
}

export function exportTemplate(input: unknown): ValidationResult<string> {
  const checked = validateTemplate(input);
  if (!checked.ok) return failure(checked.issues);
  return resultOf(`${JSON.stringify(copyTemplateData(checked.value), null, 2)}\n`, []);
}
