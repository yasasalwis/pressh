import type { PressError } from "./errors.js";

/**
 * Explicit success/failure type. Core/engine APIs return `Result<T>` rather
 * than throwing for expected failures, so callers must handle both branches.
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PressError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: PressError): Result<T> {
  return { ok: false, error };
}
