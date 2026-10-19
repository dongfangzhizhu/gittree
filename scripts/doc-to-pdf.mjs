/**
 * 文档转 PDF：用 Playwright（系统 Chrome）把提交文档 HTML 打印为 A4 PDF。
 * 用法: node scripts/doc-to-pdf.mjs
 */
import { chromium } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const htmlPath = resolve(argOf("html", resolve(ROOT, ".demo-work/submission-doc.html")));
const outPath = resolve(argOf("out", resolve(ROOT, "submission/代码年轮-GitTree-成果提交文档.pdf")));

const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "networkidle" });
await page.pdf({
  path: outPath,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate:
    "<div style=\"width:100%;text-align:center;color:#8a92b2;font-size:8pt;font-family:'Microsoft YaHei';\">" +
    "<span>代码年轮 GitTree · 项目成果提交文档</span>&nbsp;&nbsp;&nbsp;" +
    "<span class=\"pageNumber\"></span> / <span class=\"totalPages\"></span></div>",
  margin: { top: "14mm", bottom: "16mm", left: "14mm", right: "14mm" },
});
await browser.close();
console.log("PDF 已生成:", outPath);
