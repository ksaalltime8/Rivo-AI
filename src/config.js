
const env = process.env;

function validateProductionConfig() {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const required = [
    "MONGODB_URI",
    "SESSION_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_REDIRECT_URI",
    "FRONTEND_URL",
    "OWNER_EMAIL",
    "OWNER_PASSWORD_HASH"
  ];

  const missing = required.filter(
    key => !env[key] || !env[key].trim()
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing production environment variables: ${missing.join(", ")}`
    );
  }

  if (env.SESSION_SECRET.length < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 characters long."
    );
  }

  if (!/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters."
    );
  }

  let frontend;

  try {
    frontend = new URL(env.FRONTEND_URL);
  } catch {
    throw new Error("FRONTEND_URL must be a valid URL.");
  }

  if (frontend.protocol !== "https:") {
    throw new Error("FRONTEND_URL must use HTTPS in production.");
  }

  if (!env.DISCORD_REDIRECT_URI.startsWith("https://")) {
    throw new Error("DISCORD_REDIRECT_URI must use HTTPS.");
  }

  if (
    !env.DISCORD_REDIRECT_URI.endsWith(
      "/api/auth/discord/callback"
    )
  ) {
    throw new Error(
      "DISCORD_REDIRECT_URI must point to the Discord callback route."
    );
  }

  // Validate owner email.
  const ownerEmail = env.OWNER_EMAIL.trim();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)
  ) {
    throw new Error(
      "OWNER_EMAIL must be a valid email address."
    );
  }

  // Expected format:
  // scrypt$<32-character-salt-hex>$<128-character-hash-hex>
  const passwordHashPattern =
    /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/i;

  if (!passwordHashPattern.test(env.OWNER_PASSWORD_HASH)) {
    throw new Error(
      "OWNER_PASSWORD_HASH has an invalid format. Generate it using the Rivo password hash generator."
    );
  }
}

export {
  env,
  validateProductionConfig
};
