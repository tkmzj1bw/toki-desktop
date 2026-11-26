import { invoke } from '@tauri-apps/api/core';
import { toGcode as toGcodeJs } from './geometry';
import type { DrawingDoc, RigState } from '@/types';

/** No desktop o G-code é gerado pelo Rust; no navegador continua puro TypeScript. */
export const isDesktop = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const exportGcode = async (doc: DrawingDoc, rig?: RigState | null): Promise<string> => {
  if (isDesktop()) return invoke<string>('to_gcode', { doc, rig: rig ?? null });
  return toGcodeJs(doc, rig ?? undefined);
};
