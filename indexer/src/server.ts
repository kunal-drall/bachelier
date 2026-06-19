import Fastify, { type FastifyInstance } from "fastify";
import { type ChainhookPayload, extractBlockEvents } from "./chainhook.js";
import { applyBlock, lastIndexedBlock, rollbackBlocks, type AnyDb } from "./projector.js";

export interface ServerOpts {
  db: AnyDb;
  vaultContract: string;
  chainhookSecret: string;
}

export function buildServer(opts: ServerOpts): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  app.get("/health", async () => ({
    ok: true,
    lastIndexedBlock: await lastIndexedBlock(opts.db),
  }));

  app.post("/chainhook/events", async (req, reply) => {
    if (opts.chainhookSecret) {
      const auth = req.headers.authorization ?? "";
      if (auth !== opts.chainhookSecret && auth !== `Bearer ${opts.chainhookSecret}`) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }

    const payload = req.body as ChainhookPayload;
    if (!payload || (!payload.apply && !payload.rollback)) {
      return reply.code(400).send({ error: "not a chainhook payload" });
    }

    // rollbacks first (chainhook sends the orphaned fork, then re-applies)
    const rollbackHeights = (payload.rollback ?? []).map((b) => b.block_identifier.index);
    if (rollbackHeights.length > 0) {
      req.log.warn({ rollbackHeights }, "rolling back blocks");
      await rollbackBlocks(opts.db, rollbackHeights);
    }

    let applied = 0;
    for (const block of payload.apply ?? []) {
      const events = extractBlockEvents(block, opts.vaultContract);
      applied += await applyBlock(opts.db, events, block.block_identifier.index, block.timestamp ?? null);
    }

    return { ok: true, applied, rolledBack: rollbackHeights.length };
  });

  return app;
}
