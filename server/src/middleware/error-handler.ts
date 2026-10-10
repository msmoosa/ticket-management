import type { ErrorRequestHandler, RequestHandler } from "express";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: "Not Found", path: req.path });
};

// Express 5 forwards rejected promises from async handlers here automatically.
// express.json() (body-parser) errors carry a client status and `expose: true`,
// e.g. 400 for malformed JSON and 413 for a body over the size limit.
function isBodyParserError(err: unknown): err is { status: number; type?: string; message: string } {
  const e = err as { status?: unknown; expose?: unknown };
  return typeof e?.status === "number" && e.status >= 400 && e.status < 500 && e.expose === true;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (isBodyParserError(err)) {
    res.status(err.status).json({
      error:
        err.type === "entity.parse.failed"
          ? "Malformed JSON body"
          : err.type === "entity.too.large"
            ? "Request body is too large"
            : err.message,
    });
    return;
  }

  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  // HttpError messages are written for clients; anything unexpected stays opaque.
  res.status(status).json({
    error: err instanceof HttpError ? err.message : "Internal Server Error",
  });
};
