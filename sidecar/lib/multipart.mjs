export class MultipartError extends Error {
  constructor(message) {
    super(message);
    this.name = "MultipartError";
  }
}

function boundaryOf(contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new MultipartError("multipart boundary missing");
  return match[1] || match[2];
}

function parseDisposition(header) {
  const name = header.match(/\bname="([^"]+)"/i)?.[1] ?? "";
  const filename = header.match(/\bfilename="([^"]+)"/i)?.[1] ?? "";
  return { name, filename };
}

/**
 * Minimal multipart/form-data parser for a single loopback ingest upload.
 */
export function parseMultipart(buffer, contentType) {
  const boundary = boundaryOf(contentType);
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let offset = indexOf(raw, sep, 0);
  if (offset < 0) throw new MultipartError("no multipart parts");
  offset += sep.length;
  while (offset < raw.length) {
    if (raw.slice(offset, offset + 2).toString("ascii") === "--") break;
    if (raw.slice(offset, offset + 2).toString("ascii") === "\r\n") offset += 2;
    const headerEnd = indexOf(raw, Buffer.from("\r\n\r\n"), offset);
    if (headerEnd < 0) break;
    const header = raw.slice(offset, headerEnd).toString("utf8");
    const bodyStart = headerEnd + 4;
    const next = indexOf(raw, Buffer.from(`\r\n--${boundary}`), bodyStart);
    if (next < 0) break;
    const body = raw.slice(bodyStart, next);
    const { name, filename } = parseDisposition(header);
    const type = header.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? "";
    parts.push({ name, filename, mime: type, buffer: body });
    offset = next + 2 + sep.length;
  }
  return parts;
}

function indexOf(buf, needle, from) {
  return buf.indexOf(needle, from);
}

export function fieldsFromParts(parts) {
  const fields = {};
  let file = null;
  for (const part of parts) {
    if (part.filename) {
      file = part;
      continue;
    }
    fields[part.name] = part.buffer.toString("utf8");
  }
  return { fields, file };
}
