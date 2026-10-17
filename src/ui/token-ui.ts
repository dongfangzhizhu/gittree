/**
 * Token UI 控制模块 - 与 HTML 元素绑定
 */

import { loadToken, saveToken, clearToken, getTokenPreview } from "./token-manager";

export interface TokenUI {
  getToken(): string | undefined;
  onTokenChange(callback: (token: string | undefined) => void): void;
  updateStatus(token: string | undefined): void;
  initUI(): void;
}

export function createTokenUI(): TokenUI {
  const tokenInput = document.getElementById("tokenInput") as HTMLInputElement | null;
  const tokenToggleBtn = document.getElementById("tokenToggleBtn") as HTMLButtonElement | null;
  const tokenClearBtn = document.getElementById("tokenClearBtn") as HTMLButtonElement | null;
  const tokenStatus = document.getElementById("tokenStatus") as HTMLElement | null;

  let currentToken = loadToken();
  let onChangeCallback: (token: string | undefined) => void = () => {};

  if (tokenInput) {
    if (currentToken) {
      tokenInput.value = currentToken;
    }
    tokenInput.addEventListener("change", () => {
      const token = tokenInput.value.trim();
      if (token) {
        currentToken = token;
        saveToken(token);
      }
      onChangeCallback(currentToken);
      updateStatus(currentToken);
    });
  }

  if (tokenToggleBtn) {
    tokenToggleBtn.addEventListener("click", () => {
      if (tokenInput) {
        if (tokenInput.type === "password") {
          tokenInput.type = "text";
          tokenToggleBtn.textContent = "🙈";
        } else {
          tokenInput.type = "password";
          tokenToggleBtn.textContent = "👁";
        }
      }
    });
  }

  if (tokenClearBtn) {
    tokenClearBtn.addEventListener("click", () => {
      currentToken = undefined;
      if (tokenInput) tokenInput.value = "";
      clearToken();
      onChangeCallback(undefined);
      updateStatus(undefined);
    });
  }

  function updateStatus(token: string | undefined) {
    if (!tokenStatus) return;
    if (token) {
      const preview = getTokenPreview(token);
      tokenStatus.textContent = `✓ 已设置 (${preview})`;
      tokenStatus.classList.add("active");
    } else {
      tokenStatus.textContent = "未设置";
      tokenStatus.classList.remove("active");
    }
  }

  function getToken(): string | undefined {
    return currentToken;
  }

  function onTokenChange(callback: (token: string | undefined) => void): void {
    onChangeCallback = callback;
  }

  updateStatus(currentToken);

  return {
    getToken,
    onTokenChange,
    updateStatus,
    initUI: () => {
      // UI 已在创建时初始化
    }
  };
}
