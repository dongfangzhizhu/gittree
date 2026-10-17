/**
 * 错误码定义
 */

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const ErrorMessages: Record<string, { message: string; userMsg: string }> = {
  INVALID_INPUT: {
    message: "输入格式无效",
    userMsg: "这看起来不像 GitHub 仓库地址。示例：github.com/owner/repo 或 owner/repo",
  },
  UNSUPPORTED_HOST: {
    message: "不支持的域名",
    userMsg: "目前只支持 GitHub。其他平台将在后续版本支持。",
  },
  NOT_FOUND: {
    message: "仓库未找到",
    userMsg: "仓库不存在或不是公开仓库。请检查地址是否正确。",
  },
  FORBIDDEN: {
    message: "无法访问",
    userMsg: "该仓库无法访问。请确保仓库是公开的。",
  },
  RATE_LIMITED: {
    message: "请求频繁，被限流",
    userMsg: "请求太频繁，请稍候再试或输入 GitHub Token 以提高限额。",
  },
  NETWORK: {
    message: "网络错误",
    userMsg: "网络似乎不太稳定。请检查连接后重试。",
  },
  EMPTY_REPO: {
    message: "仓库无提交",
    userMsg: "这个仓库还没有提交。请选择其他仓库或预置作品。",
  },
  EXPORT_UNSUPPORTED: {
    message: "浏览器不支持导出",
    userMsg: "请用 Chrome 或 Edge 导出视频。Firefox 支持静态导出。",
  },
  EXPORT_FAILED: {
    message: "导出失败",
    userMsg: "导出过程中出错。请尝试降低分辨率后重试。",
  },
};

export function createError(code: string, overrideMessage?: string): AppError {
  const errorInfo = ErrorMessages[code] || { message: code, userMsg: "发生未知错误" };
  return new AppError(code, overrideMessage || errorInfo.message);
}
