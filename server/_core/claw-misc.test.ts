import express from "express";
import type { Server } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./context", () => ({
  createContext: vi.fn(),
}));

import { createContext } from "./context";
import { registerMiscRoutes } from "./claw-misc";

function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind test server"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe("claw misc admin routes", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("requires an admin session before AI skill review reads package data", async () => {
    vi.mocked(createContext).mockResolvedValue({ req: {} as any, res: {} as any, user: null });

    const app = express();
    app.use(express.json());
    registerMiscRoutes(app);
    const { server, url } = await listen(app);

    try {
      const res = await fetch(`${url}/api/claw/admin/ai-review-skill`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillMarketId: 1 }),
      });

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({ error: "admin only" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
