/** Vite dev-server middleware exposing the file API to the UI (local only). */
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { FileApiError, deleteManualEntry, imagePath, listLayouts, readLayout, readProfile, snapshot, upsertManualEntry, writeLayout, deleteLayout, writeProfile } from './files';

const MAX_BODY = 2 * 1024 * 1024;

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) reject(new FileApiError('Request too large.', 413));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown, type = 'application/json') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(type === 'application/json' ? JSON.stringify(payload) : (payload as string | Buffer));
}

export function fileApi(root: string): Plugin {
  return {
    name: 'og-file-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();
        const parts = url.pathname.slice(5).split('/').map(decodeURIComponent);
        try {
          if (req.method === 'GET' && parts[0] === 'files') return send(res, 200, snapshot(root));
          if (req.method === 'GET' && parts[0] === 'layouts' && !parts[1]) return send(res, 200, listLayouts(root));
          if (req.method === 'GET' && parts[0] === 'profile') return send(res, 200, { text: readProfile(root) });
          if (parts[0] === 'layouts' && parts[1]) {
            if (req.method === 'GET') return send(res, 200, readLayout(root, parts[1]), 'text/yaml; charset=utf-8');
            if (req.method === 'PUT') {
              writeLayout(root, parts[1], await body(req));
              return send(res, 200, { ok: true });
            }
            if (req.method === 'DELETE') {
              deleteLayout(root, parts[1]);
              return send(res, 200, { ok: true });
            }
          }
          if (parts[0] === 'profile' && req.method === 'PUT') {
            writeProfile(root, await body(req));
            return send(res, 200, { ok: true });
          }
          if (parts[0] === 'manual' && parts[1] && req.method === 'PUT') {
            upsertManualEntry(root, parts[1], JSON.parse(await body(req)) as Record<string, unknown>);
            return send(res, 200, { ok: true });
          }
          if (parts[0] === 'manual' && parts[1] && parts[2] && req.method === 'DELETE') {
            return send(res, 200, { ok: deleteManualEntry(root, parts[1], parts[2]) });
          }
          if (parts[0] === 'images' && req.method === 'GET') {
            const p = imagePath(root, parts.slice(1).join('/'));
            return send(res, 200, readFileSync(p), p.endsWith('.png') ? 'image/png' : 'application/octet-stream');
          }
          return send(res, 404, { error: 'Not found' });
        } catch (e) {
          const status = e instanceof FileApiError ? e.status : 500;
          return send(res, status, { error: (e as Error).message });
        }
      });
    },
  };
}
