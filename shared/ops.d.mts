// Tipi per shared/ops.mjs (il codice è JavaScript puro: lo usa anche il server Node).
import type { AppData } from '../src/types';

export type RecordKind = 'node' | 'person' | 'absence' | 'note';

export type Op =
  | { op: 'add'; t: RecordKind; rec: Record<string, unknown> & { id: string } }
  | { op: 'set'; t: RecordKind; id: string; set: Record<string, unknown>; prev?: Record<string, unknown> }
  | { op: 'del'; t: RecordKind; id: string }
  | { op: 'order'; t: 'node'; parent: string | null; ids: string[] }
  | { op: 'replace'; data: AppData };

export const KINDS: { node: 'nodes'; person: 'people'; absence: 'absences'; note: 'notes' };
export const FIELDS: Record<RecordKind, string[]>;
export function keyOf(t: RecordKind, id: string): string;
export function same(a: unknown, b: unknown): boolean;
export function pick(t: RecordKind, rec: { id: string }): Record<string, unknown> & { id: string };
export function applyOps(
  data: AppData,
  ops: Op[],
  opts?: { keep?: (t: RecordKind, id: string) => Set<string> | undefined },
): string[];
export function diffOps(before: AppData, after: AppData): Op[];
export function invalidOps(ops: unknown): string | null;
export function isPhotoUrl(v: unknown): boolean;
