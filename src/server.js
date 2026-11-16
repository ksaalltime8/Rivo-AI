
import "dotenv/config";

import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../public");

async function startServer() {
  validateProductionConfig();

  await connectDatabase();

  const app = express();

  app.disable("x-powered-by");

  // Hostinger reverse proxy configuration.
  // Required for correct client IP detection and rate limiting.
  app.set("trust proxy", 1);

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

  const sessionOptions = {
    name: "rivo.sid",
    secret:
      env.SESSION_SECRET ||
      "local-development-secret-change-before-production",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
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

  // Generate a CSRF token for API sessions.
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

  // Serve frontend files only when the directory exists.
  const publicAvailable = existsSync(publicDir);

  if (publicAvailable) {
    app.use(
      express.static(publicDir, {
        setHeaders(res, filePath) {
          if (/\.(css|js)$/i.test(filePath)) {
            res.setHeader(
              "Cache-Control",
              "no-cache, must-revalidate"
            );
          }
        }
      })
    );
  } else {
    console.warn(
      `[Rivo] Frontend directory not found: ${publicDir}`
    );
  }

  // Safe frontend page delivery.
  function sendPage(fileName, res) {
    const filePath = path.join(publicDir, fileName);

    if (!existsSync(filePath)) {
      return res.status(503).send(
        `Rivo frontend is not deployed. Missing file: ${fileName}`
      );
    }

    return res.sendFile(filePath);
  }

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

  // Website pages.
  app.get("/", (_req, res) =>
    sendPage("index.html", res)
  );

  app.get("/dashboard", (_req, res) =>
    sendPage("dashboard.html", res)
  );

  app.get("/owner", (_req, res) =>
    sendPage("owner.html", res)
  );

  // API and frontend 404 handling.
  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({
        error: "API endpoint not found."
      });
    }

    res.status(404).send("Not found.");
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

    console.log(
      `[Rivo] Hostinger proxy trust enabled`
    );

    console.log(
      `[Rivo] Frontend: ${
        publicAvailable ? "directory found" : "not deployed"
      }`
    );
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
