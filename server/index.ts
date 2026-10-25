import { resolve } from 'node:path';
import { ClubServer } from './clubServer';
import { FileStorage } from './fileStorage';
import { createHttpServer } from './http';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const dataFile = resolve(process.env.DATA_FILE ?? 'data/kniffel-club.json');
const staticDir = resolve(process.env.STATIC_DIR ?? 'dist');

const club = new ClubServer(new FileStorage(dataFile));
const server = createHttpServer({ club, staticDir });

server.listen(port, host, () => {
  console.log(`Kniffel Club läuft auf http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`Daten: ${dataFile}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
