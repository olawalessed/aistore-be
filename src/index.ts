import { Hono, Context } from "hono";
import { cors } from "hono/cors";
import { EnvBindings } from "./bindings";
import publicRoutes from "./routes/public";
import internalRoutes from "./routes/internal";
import { secureHeaders } from 'hono/secure-headers'
import { llmRateLimit } from "./middlewares/rate-limit-do";
import { rateLimitMiddleware } from "./middlewares/rate-limit";

const app = new Hono<{ Bindings: EnvBindings }>();

app.use('*', secureHeaders())
// CORS middleware for frontend
app.use(
  "/stores/*",
  cors({
    origin: ["*"],
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/", async (c: Context<{ Bindings: EnvBindings }>) => {
  return c.json({
    message: "Basekart AI Shop API Running",
    status: "ok",
    datetime: new Date().toISOString(),
  });
});

app.route("/llm", publicRoutes);
app.use("/llm/*", llmRateLimit);
app.route("/stores", internalRoutes);

app.get("/ws", async (c: Context<{ Bindings: EnvBindings }>) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.text("Expected Upgrade: websocket", 426);
  }

  // Use a unique ID (e.g., store name or user ID) to route to a specific DO
  const stub = c.env.SOCKET_DO.getByName("global-chat");

  return stub.fetch(c.req.raw);
});

export default app;

export { StoreDO } from "./durable-objects/store-do";
export { SocketDO } from "./durable-objects/socket-do";
export { RateLimitDO } from "./durable-objects/rate-limit-do";
