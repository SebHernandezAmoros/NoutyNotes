/** Copia datos ya validados, ordenando claves y omitiendo propiedades undefined (ausencia). */
export function copyTemplateData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => copyTemplateData(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, copyTemplateData(child)])) as T;
  }
  return value;
}
