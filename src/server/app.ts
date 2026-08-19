import { Hono } from "hono"
import { cors } from "hono/cors"
import { getDb } from "../database/index.js"
import { logger } from "../logging/index.js"
import { HEALTH_PATH } from "@rtwiki/shared/constants"

export const app = new Hono<{ variables: { db: ReturnType<typeof getDb> } }>()

// Security headers
app.use("*", async (c, next) => {
  await next()
  c.header("X-Content-Type-Options", "nosniff")
  c.header("X-Frame-Options", "DENY")
  c.header("Referrer-Policy", "no-referrer")
})

// CORS for localhost dev
app.use(
  "/api/*",
  cors({
    origin: ["http://127.0.0.1:*"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE"],
    allowHeaders: ["Content-Type"],
  }),
)

// Health endpoint
app.get(HEALTH_PATH, () => {
  try {
    const db = getDb()
    db.query("SELECT 1").get()
    return {
      status: "ok" as const,
      app: "RTWiki",
      version: "0.1.0",
      db: { ready: true },
      time: new Date().toISOString(),
    }
  } catch {
    return {
      status: "error" as const,
      app: "RTWiki",
      version: "0.1.0",
      db: { ready: false },
      time: new Date().toISOString(),
    }
  }
})

// Error handler
app.onError((err, c) => {
  logger.error(`Unhandled error: ${err.message}`)
  return c.json({ error: "Internal server error" }, 500)
})

// Not found handler
app.notFound((c) => c.json({ error: "Not found" }, 404))
