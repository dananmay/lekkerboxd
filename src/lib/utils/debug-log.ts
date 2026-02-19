/**
 * Debug logging scaffold.
 *
 * Keep disabled by default so normal extension behavior and console noise
 * are unchanged. This can be toggled in future via settings/storage wiring.
 */
const DEBUG_ENABLED = false;

export function debugLog(...args: unknown[]): void {
  if (DEBUG_ENABLED) {
    console.debug('[Lekkerboxd DEBUG]', ...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (DEBUG_ENABLED) {
    console.warn('[Lekkerboxd DEBUG]', ...args);
  }
}
