import http from 'node:http';
import net from 'node:net';

const listenPort = Number(process.env.PORT || 3000);
const frontend = {hostname: 'frontend', port: 5173};
const backend = {hostname: 'backend', port: 8888};

function targetFor(pathname) {
  return pathname.startsWith('/api/') || pathname.startsWith('/download/') || pathname.startsWith('/public/')
    ? backend
    : frontend;
}

const server = http.createServer((request, response) => {
  const target = targetFor(request.url || '/');
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      method: request.method,
      path: request.url,
      headers: {...request.headers, host: `${target.hostname}:${target.port}`},
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on('error', (error) => {
    if (!response.headersSent) response.writeHead(502, {'content-type': 'text/plain'});
    response.end(`gateway upstream error: ${error.message}`);
  });
  request.pipe(upstream);
});

server.on('upgrade', (request, socket, head) => {
  const target = targetFor(request.url || '/');
  const upstream = net.connect(target.port, target.hostname, () => {
    const headers = Object.entries({...request.headers, host: `${target.hostname}:${target.port}`})
      .map(([name, value]) => `${name}: ${value}`)
      .join('\r\n');
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
});

server.listen(listenPort, '0.0.0.0');
