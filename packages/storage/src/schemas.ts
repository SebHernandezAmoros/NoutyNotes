import { z } from 'zod';

/*
 * Esquemas de forma con claves cerradas (ADR 0007). Solo comprueban estructura y tipos básicos;
 * formatos de ID, referencias, campos y geometría los valida el dominio, que es la única fuente de
 * esas reglas.
 */

const text = z.string();
const fieldValue = z.union([z.string(), z.number(), z.boolean()]);

export const rectSchema = z.strictObject({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export const placementSchema = z.strictObject({ cardId: text, rect: rectSchema, display: text });
export const layoutSchema = z.strictObject({ boardId: text, placements: z.array(placementSchema) });
export const relationSchema = z.strictObject({ id: text, typeId: text, from: text, to: text, label: text.optional() });

export const fieldDefinitionSchema = z.strictObject({
  key: text, kind: text, label: text.optional(), required: z.boolean().optional(), options: z.array(text).optional(),
});
export const cardTypeSchema = z.strictObject({ id: text, label: text, base: text, fields: z.array(fieldDefinitionSchema) });
export const relationTypeSchema = z.strictObject({ id: text, label: text });
export const metadataSchema = z.strictObject({ name: text, description: text.optional() });

export const cardSchema = z.strictObject({
  id: text, typeId: text, title: text.optional(), content: text.optional(),
  fields: z.record(text, fieldValue), assetRefs: z.array(text).optional(),
});
export const boardSchema = z.strictObject({ id: text, title: text, description: text.optional(), cardIds: z.array(text) });

/** Forma del Workspace del dominio que el serializador sabe escribir sin perder claves. */
export const workspaceSchema = z.strictObject({
  schemaVersion: z.number(), id: text, metadata: metadataSchema,
  cardTypes: z.array(cardTypeSchema), relationTypes: z.array(relationTypeSchema),
  cards: z.array(cardSchema), boards: z.array(boardSchema),
  layouts: z.array(layoutSchema), relations: z.array(relationSchema),
});

// Documentos del formato v1.
export const relationsFileSchema = z.strictObject({ schemaVersion: z.literal(1), relations: z.array(relationSchema) });
export const layoutFileSchema = z.strictObject({ schemaVersion: z.literal(1), layouts: z.array(layoutSchema) });
export const workspaceManifestSchema = z.strictObject({
  schemaVersion: z.literal(1), id: text, metadata: metadataSchema,
  cardTypes: z.array(cardTypeSchema), relationTypes: z.array(relationTypeSchema),
  cards: z.array(text), boards: z.array(text),
});
export const cardFrontmatterSchema = z.strictObject({
  schemaVersion: z.literal(1), id: text, typeId: text, title: text.optional(),
  fields: z.record(text, fieldValue), assetRefs: z.array(text).optional(), contentPresent: z.boolean(),
});
export const boardFrontmatterSchema = z.strictObject({
  schemaVersion: z.literal(1), id: text, title: text, cardIds: z.array(text), descriptionPresent: z.boolean(),
});
export const templateFileSchema = z.strictObject({
  schemaVersion: z.literal(1), definition: z.record(text, z.unknown()), readmeFile: z.literal('README.md').optional(),
});
