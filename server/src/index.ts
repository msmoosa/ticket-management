import { createApp } from "./app.ts";
import { prisma } from "./db.ts";

const port = Number(process.env.PORT ?? 3000);

const server = createApp().listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

// Railway (and Docker) stop the container with SIGTERM: finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}
