import { createApp } from './app';

const { server } = createApp();

const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`OBD Express running → http://localhost:${PORT}`);
});
