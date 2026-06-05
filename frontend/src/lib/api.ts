export const API_BASE = import.meta.env.VITE_API_URL ?? '';

export const apiFetch = (path: string, init?: RequestInit) =>
  fetch(`${API_BASE}${path}`, init);