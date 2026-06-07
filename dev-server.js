// Local dev server — bypasses Netlify CLI proxy so API calls go directly from this machine
require('dotenv').config({ path: '.env.local' });

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8888;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// Lazily require function handlers so env is loaded first
const HANDLERS = {
  'analyze-image': () => require('./netlify/functions/analyze-image').handler,
  'match-plants':  () => require('./netlify/functions/match-plants').handler,
  'generate-rag':  () => require('./netlify/functions/generate-rag').handler,
};

async function handleFunction(name, req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();

  const event = {
    httpMethod: req.method,
    headers: req.headers,
    body,
    queryStringParameters: Object.fromEntries(new url.URL(req.url, 'http://localhost').searchParams)
  };

  try {
    const getHandler = HANDLERS[name];
    if (!getHandler) { res.writeHead(404); res.end('Function not found'); return; }

    const result = await getHandler()(event, {});
    res.writeHead(result.statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...(result.headers || {})
    });
    res.end(result.body);
  } catch (err) {
    console.error(`[${name}] error:`, err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
    res.end(); return;
  }

  const pathname = url.parse(req.url).pathname;

  // Route /api/:function → netlify/functions/:function
  const fnMatch = pathname.match(/^\/api\/(.+)/);
  if (fnMatch) {
    await handleFunction(fnMatch[1], req, res);
    return;
  }

  // Serve static files
  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  if (!fs.existsSync(filePath)) {
    // SPA fallback
    filePath = path.join(ROOT, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  ✦ Local dev server ready: http://localhost:${PORT}\n`);
  console.log('  Functions: /api/analyze-image  /api/match-plants  /api/generate-rag\n');
});
