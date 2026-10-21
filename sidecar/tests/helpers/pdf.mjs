import { writeFile } from "node:fs/promises";

/** Minimal one-page PDF with a Helvetica text layer. */
export function textLayerPdf(text = "Hello Tabulect text layer") {
  const escaped = String(text).replace(/\\/g, "\\\\").replace(/[()]/g, "\\$&");
  const stream = `BT /F1 12 Tf 40 700 Td (${escaped}) Tj ET\n`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}endstream\nendobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body);
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return body;
}

export async function writeTextPdf(path, text) {
  await writeFile(path, textLayerPdf(text));
  return path;
}

/** PDF with an empty content stream — no usable text layer. */
export async function writeEmptyPdf(path) {
  await writeFile(path, textLayerPdf(""));
  return path;
}
