import http from 'node:http';
import fs from 'node:fs/promises';

const file = new URL('./index.html', import.meta.url);
const server = http.createServer(async (_req, res) => {
  try {
    const html = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(error?.message || error));
  }
});
server.listen(4180, '127.0.0.1', () => console.log('Relay demo: http://127.0.0.1:4180  (исправленный вариант: /fixed)'));
