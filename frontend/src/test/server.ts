import { setupServer } from "msw/node";

/** Shared MSW server. Tests add handlers with `server.use(http.get(...))`; nothing is mocked by default. */
export const server = setupServer();
