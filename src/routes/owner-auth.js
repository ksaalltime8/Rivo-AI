
import { Router } from "express";
import crypto from "node:crypto";
import { promisify } from "node:util";

import { env } from "../config.js";
import { randomState, safeEqual } from "../security.js";

const router = Router();
const scrypt = promisify(crypto.scrypt);

const SESSION_COOKIE = "rivo.sid";

function getPasswordHash() {
  const parts = String(env.OWNER_PASSWORD_HASH || "").split("$");

  if (
    parts.length !== 3 ||
    parts[0] !== "scrypt" ||
    !/^[a-f0-9]{32}$/i.test(parts[1]) ||
    !/^[a-f0-9]{128}$/i.test(parts[2])
  ) {
    return null;
  }

  return {
    salt: Buffer.from(parts[1], "hex"),
    hash: Buffer.from(parts[2], "hex")
  };
}

async function verifyPassword(password) {
  const stored = getPasswordHash();

  if (!stored) return false;

  const derived = await scrypt(
    password,
    stored.salt,
    64
  );

  return crypto.timingSafeEqual(
    Buffer.from(derived),
    stored.hash
  );
}

function saveSession(session) {
  return new Promise((resolve, reject) => {
    session.save(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function regenerateSession(session) {
  return new Promise((resolve, reject) => {
    session.regenerate(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

router.get("/me", (req, res) => {
  res.set("Cache-Control", "no-store");

  if (
    req.session?.ownerAuthenticated !== true ||
    !req.session?.ownerEmail ||
    !safeEqual(
      String(req.session.ownerEmail).toLowerCase(),
      String(env.OWNER_EMAIL || "").trim().toLowerCase()
    )
  ) {
    return res.status(401).json({
      authenticated: false
    });
  }

  res.json({
    authenticated: true,
    email: req.session.ownerEmail
  });
});

router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body?.password || "");

    const configuredEmail = String(env.OWNER_EMAIL || "")
      .trim()
      .toLowerCase();

    if (
      !email ||
      !password ||
      email.length > 254 ||
      password.length > 1024
    ) {
      return res.status(400).json({
        error: "Enter your email and password."
      });
    }

    const validEmail = safeEqual(email, configuredEmail);

    // Always perform password verification to reduce timing differences.
    const validPassword = await verifyPassword(password);

    if (!validEmail || !validPassword) {
      return res.status(401).json({
        error: "Incorrect email or password."
      });
    }

    // Regenerate the session after successful authentication.
    await regenerateSession(req.session);

    req.session.ownerAuthenticated = true;
    req.session.ownerEmail = configuredEmail;
    req.session.csrfToken = randomState();

    await saveSession(req.session);

    res.set("Cache-Control", "no-store");

    res.json({
      authenticated: true,
      email: configuredEmail
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    await new Promise((resolve, reject) => {
      if (!req.session) return resolve();

      req.session.destroy(error => {
        if (error) reject(error);
        else resolve();
      });
    });

    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite:
        env.NODE_ENV === "production" ? "none" : "lax",
      path: "/"
    });

    res.set("Cache-Control", "no-store");

    res.json({
      authenticated: false,
      message: "Signed out successfully."
    });
  } catch (error) {
    next(error);
  }
});

export default router;
