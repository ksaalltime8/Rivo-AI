
const env = process.env;

function validateProductionConfig() {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const required = [
    "MONGODB_URI",
    "SESSION_SECRET"
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
}

export {
  env,
  validateProductionConfig
};
