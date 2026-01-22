import { Hono, Context } from "hono";
import { cors } from "hono/cors";
import { EnvBindings } from "./bindings";
import publicRoutes from "./routes/public";
import internalRoutes from "./routes/internal";

import { rateLimitMiddleware } from "./middlewares/rate-limit";


const app = new Hono<{ Bindings: EnvBindings }>();

// CORS middleware for frontend
app.use('/stores/*', cors({
  origin: ['http://localhost:3000', 'https://beaf3866855a.ngrok-free.app'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get("/", async (c: Context<{ Bindings: EnvBindings }>) => {
  return c.json({
    message: "Basekart AI Shop API Running",
    status: "ok",
    datetime: new Date().toISOString()
  });
})

app.route("/llm", publicRoutes);
app.use("/llm/*", rateLimitMiddleware);
app.route("/stores", internalRoutes);

export default app;

export { StoreDO } from "./durable-objects/StoreDO";
