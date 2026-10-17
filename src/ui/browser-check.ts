/**
 * 浏览器兼容性检查模块
 */

export interface BrowserSupport {
  hasCanvas: boolean;
  hasMediaRecorder: boolean;
  hasCanvasToBlob: boolean;
  canExportVideo: boolean;
  canExportCard: boolean;
}

export function checkBrowserSupport(): BrowserSupport {
  // 检查 Canvas 支持
  const canvas = document.createElement("canvas");
  const hasCanvas = !!(canvas.getContext && canvas.getContext("2d"));

  // 检查 MediaRecorder (用于视频导出)
  const hasMediaRecorder = typeof MediaRecorder !== "undefined";

  // 检查 Canvas toBlob (用于 PNG 导出)
  const hasCanvasToBlob = typeof canvas.toBlob === "function";

  // 检查 captureStream (用于视频导出)
  const hasCaptureStream = typeof canvas.captureStream === "function";

  return {
    hasCanvas,
    hasMediaRecorder,
    hasCanvasToBlob,
    canExportVideo: hasCanvas && hasMediaRecorder && hasCaptureStream,
    canExportCard: hasCanvas && hasCanvasToBlob,
  };
}

export function getExportWarnings(support: BrowserSupport): string[] {
  const warnings: string[] = [];

  if (!support.canExportVideo) {
    warnings.push("Video export not supported in this browser (need Canvas + MediaRecorder + captureStream)");
  }

  if (!support.canExportCard) {
    warnings.push("Card export not supported in this browser (need Canvas + toBlob)");
  }

  return warnings;
}

export function getBrowserInfo(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari")) return "Safari";
  if (ua.includes("Edge")) return "Edge";
  return "Unknown";
}
