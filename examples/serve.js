const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);

const root = path.resolve(__dirname, '..');
const examplesDir = path.join(root, 'examples');
const distDir = path.join(root, 'dist');
const fixturesDir = path.join(root, 'fixtures');

const mimeByExt = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

const getMimeType = (filePath) =>
  mimeByExt[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

const safeResolve = (baseDir, relativePath) => {
  const clean = relativePath.replace(/^\/+/, '');
  const absolute = path.resolve(baseDir, clean);
  if (!absolute.startsWith(baseDir + path.sep) && absolute !== baseDir) {
    return null;
  }
  return absolute;
};

const send = (res, statusCode, body, contentType = 'text/plain; charset=utf-8') => {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

const serveFile = (res, filePath) => {
  fs.stat(filePath, (statError, stats) => {
    if (statError) {
      send(
        res,
        statError.code === 'ENOENT' ? 404 : 500,
        statError.code === 'ENOENT' ? 'Not found' : 'Internal server error'
      );
      return;
    }

    const resolvedPath = stats.isDirectory() ? path.join(filePath, 'index.html') : filePath;

    fs.readFile(resolvedPath, (readError, data) => {
      if (readError) {
        send(
          res,
          readError.code === 'ENOENT' ? 404 : 500,
          readError.code === 'ENOENT' ? 'Not found' : 'Internal server error'
        );
        return;
      }
      send(res, 200, data, getMimeType(resolvedPath));
    });
  });
};

const server = http.createServer((req, res) => {
  if (!req.url) {
    send(res, 400, 'Bad request');
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url, `http://${host}:${port}`).pathname;
    pathname = decodeURIComponent(pathname);
  } catch {
    send(res, 400, 'Malformed URL');
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    serveFile(res, path.join(examplesDir, 'index.html'));
    return;
  }

  if (pathname === '/favicon.ico') {
    send(res, 204, '', 'image/x-icon');
    return;
  }

  if (pathname.startsWith('/examples/')) {
    const filePath = safeResolve(examplesDir, pathname.slice('/examples/'.length));
    if (!filePath) {
      send(res, 403, 'Forbidden');
      return;
    }
    serveFile(res, filePath);
    return;
  }

  if (pathname.startsWith('/dist/')) {
    const filePath = safeResolve(distDir, pathname.slice('/dist/'.length));
    if (!filePath) {
      send(res, 403, 'Forbidden');
      return;
    }
    serveFile(res, filePath);
    return;
  }

  if (pathname.startsWith('/fixtures/')) {
    const filePath = safeResolve(fixturesDir, pathname.slice('/fixtures/'.length));
    if (!filePath) {
      send(res, 403, 'Forbidden');
      return;
    }
    serveFile(res, filePath);
    return;
  }

  send(res, 404, 'Not found');
});

server.listen(port, host, () => {
  console.log(`Demo server running at http://${host}:${port}`);
});
