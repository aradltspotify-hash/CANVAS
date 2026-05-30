import { createServer } from "http";

const PORT = process.env.PORT || 8080;

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor en puerto ${PORT}`);
});
