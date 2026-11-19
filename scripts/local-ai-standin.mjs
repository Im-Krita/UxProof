import http from 'node:http';

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/chat') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
    return;
  }
  let size = 0;
  for await (const chunk of req) size += chunk.length;
  const content = JSON.stringify({
    suggestions: [{
      title: 'Локальный стенд увидел снимок',
      description: `Получен запрос ${size} байт. Это не облачная модель и не подтверждённый дефект: рекомендацию нужно проверить вручную.`,
      severity: 'low'
    }]
  });
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ message: { content } }));
});
server.listen(11434, '127.0.0.1', () => console.log('local AI stand-in: http://127.0.0.1:11434/api/chat'));
