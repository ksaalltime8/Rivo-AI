
import mongoose from "mongoose";
import { User } from "./models.js";
import { encryptSecret } from "./security.js";

export async function connectDatabase() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });

  // Encrypt legacy plaintext OAuth tokens before using the encrypted-token system.
  // Twitch is retained here only for historical database compatibility.
  const users = await User.find({
    $or: [
      { "providers.discord.accessToken": { $exists: true, $not: /^enc:v1:/ } },
      { "providers.discord.refreshToken": { $exists: true, $not: /^enc:v1:/ } },

      { "providers.kick.accessToken": { $exists: true, $not: /^enc:v1:/ } },
      { "providers.kick.refreshToken": { $exists: true, $not: /^enc:v1:/ } },

      { "providers.twitch.accessToken": { $exists: true, $not: /^enc:v1:/ } },
      { "providers.twitch.refreshToken": { $exists: true, $not: /^enc:v1:/ } },

      { "providers.youtube.accessToken": { $exists: true, $not: /^enc:v1:/ } },
      { "providers.youtube.refreshToken": { $exists: true, $not: /^enc:v1:/ } }
    ]
  }).select("providers");

  let migratedCount = 0;

  for (const user of users) {
    const updates = {};

    const providers = [
      "discord",
      "kick",
      "twitch",
      "youtube"
    ];

    const tokenFields = [
      "accessToken",
      "refreshToken"
    ];

    for (const provider of providers) {
      for (const field of tokenFields) {
        const value = user.providers?.[provider]?.[field];

        if (
          value &&
          !String(value).startsWith("enc:v1:")
        ) {
          updates[`providers.${provider}.${field}`] =
            encryptSecret(String(value));
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await User.updateOne(
        { _id: user._id },
        { $set: updates }
      );

      migratedCount++;
    }
  }

  if (migratedCount > 0) {
    console.log(
      `[Rivo] Encrypted legacy OAuth tokens for ${migratedCount} account(s)`
    );
  }

  console.log("[Rivo] MongoDB connected");
}
