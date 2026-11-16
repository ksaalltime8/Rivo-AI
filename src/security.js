
import crypto from "node:crypto";
import { User } from "./models.js";

export function requireUser(req, res, next) {
  if (!req.session?.userId || !req.user) {
    return res.status(401).json({
      error: "Sign in required"
    });
  }

  next();
}

export function requireOwner(req, res, next) {
  const owner = (process.env.OWNER_EMAIL || "").toLowerCase();
  const email = (req.user?.email || "").toLowerCase();

  if (!req.user || !owner || email !== owner) {
    return res.status(404).json({
      error: "Not found"
    });
  }

  next();
}

export async function attachUser(req, res, next) {
  try {
    req.user = null;

    const userId = req.session?.userId;

    if (!userId) {
      return next();
    }

    const user = await User.findById(userId)
      .select("_id email displayName avatar providers")
      .lean();

    if (!user) {
      req.session.destroy(error => {
        if (error) {
          console.error("[Rivo] Session cleanup failed:", error);
        }
      });

      return next();
    }

    req.user = user;

    next();
  } catch (error) {
    next(error);
  }
}

export function randomState() {
  return crypto.randomBytes(32).toString("hex");
}

export function pkcePair() {
  const verifier = crypto.randomBytes(48).toString("base64url");

  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  return {
    verifier,
    challenge
  };
}

export function safeEqual(a = "", b = "") {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));

  return (
    x.length === y.length &&
    crypto.timingSafeEqual(x, y)
  );
}

function encryptionKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY || "";

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  if (process.env.NODE_ENV !== "production") {
    return crypto
      .createHash("sha256")
      .update(
        process.env.SESSION_SECRET ||
        "rivo-local-development-only-key"
      )
      .digest();
  }

  throw new Error(
    "TOKEN_ENCRYPTION_KEY must be a 64-character hex key"
  );
}

export function encryptSecret(value) {
  if (!value) return "";

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final()
  ]);

  return [
    "enc",
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

export function decryptSecret(value) {
  if (!value) return "";

  const secret = String(value);

  if (!secret.startsWith("enc:v1:")) {
    return secret;
  }

  const [, version, iv, tag, data] = secret.split(":");

  if (version !== "v1" || !iv || !tag || !data) {
    throw new Error("Invalid encrypted secret format");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url")
  );

  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function csrfGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  if (req.path.startsWith("/webhooks/")) {
    return next();
  }

  const token = req.get("x-csrf-token");

  if (
    !req.session?.csrfToken ||
    !safeEqual(token || "", req.session.csrfToken)
  ) {
    return res.status(403).json({
      error: "Security check failed. Refresh the page and try again."
    });
  }

  next();
}
