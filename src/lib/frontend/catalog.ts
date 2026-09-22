import catalog from "./catalog.json";
import type { Operation, Schema } from "./types";
export const operations = catalog.operations as Operation[];
export function rawSchema(schema: Schema = {}): Schema {
  return schema.$ref ? rawSchema((catalog.schemas as unknown as Record<string, Schema>)[schema.$ref.split("/").pop()!] ?? {}) : schema;
}
export function resolveSchema(input: Schema = {}, value?: Record<string, unknown>): Schema {
  const schema = rawSchema(input);
  const variants = (schema.anyOf ?? schema.oneOf)?.filter(s => s.type !== "null");
  const variant = variants?.find(s => Object.entries(s.properties ?? {}).some(([key, field]) => field.const !== undefined && field.const === value?.[key])) ?? variants?.[0];
  if (variant) return { ...schema, ...resolveSchema(variant), anyOf: undefined, oneOf: undefined };
  return schema;
}
export const operation = (id: string) => operations.find(op => op.id === id)!;
