import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { fieldsFromParts, parseMultipart } from "../lib/multipart.mjs";

test("parses Node FormData file + provider + locale", async () => {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { fields, file } = fieldsFromParts(
      parseMultipart(Buffer.concat(chunks), req.headers["content-type"]),
    );
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      provider: fields.provider,
      tableLocale: fields.tableLocale,
      filename: file?.filename,
      text: file?.buffer.toString("utf8"),
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const form = new FormData();
  form.set("file", new Blob(["# Hi\n\ntext"], { type: "text/markdown" }), "hi.md");
  form.set("provider", "codex");
  form.set("tableLocale", "tr");
  const body = await fetch(`http://127.0.0.1:${port}`, { method: "POST", body: form }).then((r) => r.json());
  server.close();
  assert.equal(body.provider, "codex");
  assert.equal(body.tableLocale, "tr");
  assert.equal(body.filename, "hi.md");
  assert.match(body.text, /Hi/);
});
