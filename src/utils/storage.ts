export const STATE_KEY = "pop33_state_v1";

export function loadState<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveState<T>(state: T) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}
