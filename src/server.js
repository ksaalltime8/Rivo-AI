
import "dotenv/config";

import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";

import { env, validateProductionConfig } from "./config.js";
import { connectDatabase } from "./db.js";

import {
  csrfGuard,
  attachUser,
  randomState
} from "./security.js";

import auth from "./routes/auth.js";
import api from "./routes/api.js";
import webhooks from "./routes/webhooks.js";

const FRONTEND_ORIGIN = (
  env.FRONTEND_URL || "https://iik27.com"
).replace(/\/$/, "");

async function startServer() {
  validateProductionConfig();

  await connectDatabase();

  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // CORS: allow the Rivo website to communicate with this API.
  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && origin !== FRONTEND_ORIGIN) {
      return res.status(403).json({
        error: "Origin not allowed."
      });
    }

    if (origin === FRONTEND_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-CSRF-Token, Authorization"
      );
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: {
        policy: "cross-origin"
      }
    })
  );

  app.use(
    morgan(
      env.NODE_ENV === "production" ? "combined" : "dev"
    )
  );

  // Session configuration.
  const sessionOptions = {
    name: "rivo.sid",
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite:
        env.NODE_ENV === "production" ? "none" : "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  };

  if (env.MONGODB_URI) {
    sessionOptions.store = MongoStore.create({
      mongoUrl: env.MONGODB_URI,
      collectionName: "rivo_sessions",
      ttl: 7 * 24 * 60 * 60
    });
  }

  app.use(session(sessionOptions));

  // Preserve raw webhook bodies for signature verification.
  app.post(
    "/api/webhooks/kick",
    express.raw({
      type: "application/json",
      limit: "1mb"
    })
  );

  app.post(
    "/api/webhooks/youtube",
    express.raw({
      type: [
        "application/atom+xml",
        "application/xml",
        "text/xml"
      ],
      limit: "1mb"
    })
  );

  app.use(express.json({ limit: "1mb" }));

  app.use(
    express.urlencoded({
      extended: false,
      limit: "1mb"
    })
  );

  // Global API rate limit.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  // Additional authentication rate limit.
  app.use(
    "/api/auth",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  // Create a CSRF token for each API session.
  app.use((req, res, next) => {
    if (
      req.path.startsWith("/api/") &&
      !req.session.csrfToken
    ) {
      req.session.csrfToken = randomState();
    }

    next();
  });

  app.use(attachUser);

  // API routes.
  app.use("/api/auth", auth);
  app.use("/api", csrfGuard, api);
  app.use("/api/webhooks", webhooks);

  // Discord bot invite.
  app.get("/invite", (_req, res) => {
    if (!env.DISCORD_CLIENT_ID) {
      return res.status(503).send(
        "Rivo invite is not configured."
      );
    }

    const url = new URL(
      "https://discord.com/oauth2/authorize"
    );

    url.search = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      scope: "bot applications.commands",
      permissions: env.DISCORD_BOT_PERMISSIONS || "0"
    }).toString();

    res.redirect(url);
  });

  // API-only 404 handling.
  app.use((req, res) => {
    res.status(404).json({
      error: "API endpoint not found."
    });
  });

  // Central error handler.
  app.use((error, req, res, next) => {
    console.error("[Rivo backend]", error);

    if (res.headersSent) {
      return next(error);
    }

    const status =
      error.name === "ZodError"
        ? 400
        : Number(error.status) || 500;

    res.status(status).json({
      error:
        status >= 500
          ? "Internal server error."
          : error.message,

      ...(env.NODE_ENV !== "production" && status >= 500
        ? { detail: error.message }
        : {})
    });
  });

  const server = app.listen(env.PORT, () => {
    console.log(
      `[Rivo Backend V2] listening on ${env.PORT}`
    );

    console.log("[Rivo] Hostinger proxy trust enabled");
    console.log(`[Rivo] CORS frontend: ${FRONTEND_ORIGIN}`);
    console.log("[Rivo] API-only mode enabled");
  });

  // Graceful shutdown.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      console.log(`[Rivo] Received ${signal}`);

      server.close(async () => {
        console.log("[Rivo] HTTP server closed.");

        try {
          const mongoose = await import("mongoose");
          await mongoose.default.disconnect();
        } catch (error) {
          console.error(
            "[Rivo] Database shutdown:",
            error
          );
        }

        process.exit(0);
      });
    });
  }

  return server;
}

startServer().catch(error => {
  console.error("[Rivo startup failed]", error);
  process.exitCode = 1;
});
