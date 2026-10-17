/**
 * 错误处理和用户消息工具
 */

export interface ErrorInfo {
  code: string;
  userMessage: string;
  details?: string;
  retryable: boolean;
  suggestion?: string;
}

const ERROR_MAP: Record<string, ErrorInfo> = {
  INVALID_INPUT: {
    code: "INVALID_INPUT",
    userMessage: "Repository address format invalid",
    details: "Use format: owner/repo or https://github.com/owner/repo",
    retryable: true,
    suggestion: "Check the address and try again"
  },
  NOT_FOUND: {
    code: "NOT_FOUND",
    userMessage: "Repository not found",
    details: "Repository does not exist or is not public",
    retryable: true,
    suggestion: "Check repository address and ensure it is public"
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    userMessage: "Cannot access repository",
    details: "Repository does not allow public access",
    retryable: false,
    suggestion: "Ensure repository is public, or provide GitHub Token for higher access"
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    userMessage: "API rate limit exceeded",
    details: "GitHub API rate limit triggered",
    retryable: true,
    suggestion: "Wait and try again, or provide GitHub Personal Access Token (60 -> 5000 requests/hour)"
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    userMessage: "Network connection error",
    details: "Cannot connect to GitHub API",
    retryable: true,
    suggestion: "Check network connection and try again"
  },
  EMPTY_REPO: {
    code: "EMPTY_REPO",
    userMessage: "Repository is empty",
    details: "Repository has no commits",
    retryable: false,
    suggestion: "Choose another repository or use a preset"
  },
  ABORT_ERROR: {
    code: "ABORT_ERROR",
    userMessage: "Operation cancelled",
    details: "User cancelled loading",
    retryable: true,
    suggestion: "Click Load again to retry"
  },
  UNKNOWN_ERROR: {
    code: "UNKNOWN_ERROR",
    userMessage: "Unknown error occurred",
    details: "Check browser console for details",
    retryable: true,
    suggestion: "Try again or choose another repository"
  }
};

export function parseError(error: any): ErrorInfo {
  if (error.code) {
    const mapped = ERROR_MAP[error.code];
    if (mapped) {
      return mapped;
    }
  }

  if (error instanceof TypeError && error.message.includes("fetch")) {
    return ERROR_MAP.NETWORK_ERROR;
  }

  if (error.name === "AbortError") {
    return ERROR_MAP.ABORT_ERROR;
  }

  const msg = error.message || "";
  if (msg.includes("RATE_LIMITED") || msg.includes("429")) {
    return ERROR_MAP.RATE_LIMITED;
  }
  if (msg.includes("NOT_FOUND") || msg.includes("404")) {
    return ERROR_MAP.NOT_FOUND;
  }
  if (msg.includes("FORBIDDEN") || msg.includes("403")) {
    return ERROR_MAP.FORBIDDEN;
  }
  if (msg.includes("empty") || msg.includes("no commits")) {
    return ERROR_MAP.EMPTY_REPO;
  }

  return {
    ...ERROR_MAP.UNKNOWN_ERROR,
    details: error.message || "No error message"
  };
}

export function formatErrorForUI(error: any): string {
  const info = parseError(error);
  let message = info.userMessage;
  if (info.details) {
    message += "\n" + info.details;
  }
  if (info.suggestion) {
    message += "\n\nSuggestion: " + info.suggestion;
  }
  return message;
}
