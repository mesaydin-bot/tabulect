The sidecar is `sidecar/launch.sh`, copied to `tabulect-backend-$TARGET_TRIPLE`.

Tauri looks for `tabulect-backend-$TARGET_TRIPLE` next to this file. The launcher finds Node and `sidecar/server.mjs` (dev tree or bundled Resources).

Live service:

    http://127.0.0.1:8755

    GET  /health
    GET  /providers
    POST /ingest          (multipart file + provider + tableLocale)
    GET  /ingest/:jobId/events
    GET  /documents
    GET  /documents/:id

If spawn or health fails, Tabulect still opens the committed fixture.
Users never type a port.
