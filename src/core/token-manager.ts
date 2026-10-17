/**
 * Token 本地存储管理模块
 */

const STORAGE_KEY = "gittree_github_token";

export function loadToken(): string | undefined {
  return localStorage.getItem(STORAGE_KEY) || undefined;
}

export function saveToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getTokenPreview(token: string): string {
  if (token.length < 8) return token;
  return token.substring(0, 4) + "..." + token.substring(token.length - 4);
}
