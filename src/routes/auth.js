
import { Router } from "express";
import { User } from "../models.js";

import {
  randomState,
  pkcePair,
  encryptSecret,
  safeEqual
} from "../security.js";

const router = Router();

const FRONTEND_URL = (
  process.env.FRONTEND_URL || "https://iik27.com"
).replace(/\/$/, "");

const form = values =>
  new URLSearchParams(
    Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );

function dashboardRedirect(provider) {
  return `${FRONTEND_URL}/dashboard?connected=${encodeURIComponent(provider)}`;
}

function loginRedirect(res) {
  return res.redirect("/api/auth/discord");
}

function stateFor(req, key) {
  const state = randomState();
  req.session[key] = state;
  return state;
}

async function exchange(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error_description ||
      data.message ||
      `Provider token exchange failed (${response.status})`
    );
  }

  return data;
}

// --------------------------------------------------
// DISCORD LOGIN
// --------------------------------------------------

router.get("/discord", (req, res) => {
  const {
    DISCORD_CLIENT_ID,
    DISCORD_REDIRECT_URI
  } = process.env;

  if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
    return res.status(503).send(
      "Discord connection is not configured yet."
    );
  }

  const state = stateFor(req, "oauthState");

  const query = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify email guilds",
    state
  });

  res.redirect(
    `https://discord.com/oauth2/authorize?${query}`
  );
});

router.get("/discord/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (
      typeof code !== "string" ||
      typeof state !== "string" ||
      !req.session.oauthState ||
      !safeEqual(state, req.session.oauthState)
    ) {
      return res.status(400).send("Invalid OAuth state.");
    }

    delete req.session.oauthState;

    const token = await exchange(
      "https://discord.com/api/oauth2/token",
      {
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      }
    );

    const profileResponse = await fetch(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`
        }
      }
    );

    if (!profileResponse.ok) {
      return res.status(502).send(
        "Discord profile lookup failed."
      );
    }

    const profile = await profileResponse.json();

    const user = await User.findOneAndUpdate(
      { "providers.discord.id": profile.id },
      {
        $set: {
          email: profile.email,
          displayName: profile.global_name || profile.username,
          avatar: profile.avatar
            ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
            : null,

          "providers.discord.id": profile.id,
          "providers.discord.accessToken": encryptSecret(token.access_token),
          "providers.discord.refreshToken": encryptSecret(token.refresh_token),
          "providers.discord.connectedAt": new Date()
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    // Regenerate the session after successful authentication.
    await new Promise((resolve, reject) => {
      req.session.regenerate(error =>
        error ? reject(error) : resolve()
      );
    });

    req.session.userId = String(user._id);
    req.session.email = user.email;
    req.session.displayName = user.displayName;
    req.session.csrfToken = randomState();

    await new Promise((resolve, reject) => {
      req.session.save(error =>
        error ? reject(error) : resolve()
      );
    });

    return res.redirect(
      `${FRONTEND_URL}/dashboard?connected=discord`
    );
  } catch (error) {
    console.error("[Rivo Discord OAuth]", error);

    return res.status(502).send(
      "Could not securely connect Discord. Please try again."
    );
  }
});

// --------------------------------------------------
// KICK CONNECTION
// --------------------------------------------------

router.get("/kick", (req, res) => {
  if (!req.session.userId) {
    return loginRedirect(res);
  }

  const {
    KICK_CLIENT_ID,
    KICK_REDIRECT_URI
  } = process.env;

  if (!KICK_CLIENT_ID || !KICK_REDIRECT_URI) {
    return res.status(503).send(
      "Kick connection is not configured yet."
    );
  }

  const { verifier, challenge } = pkcePair();
  const state = stateFor(req, "kickOAuthState");

  req.session.kickVerifier = verifier;

  const query = new URLSearchParams({
    client_id: KICK_CLIENT_ID,
    redirect_uri: KICK_REDIRECT_URI,
    response_type: "code",
    scope: "user:read channel:read events:subscribe chat:write",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  res.redirect(
    `https://id.kick.com/oauth/authorize?${query}`
  );
});

router.get("/kick/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!req.session.userId) {
      return loginRedirect(res);
    }

    if (
      typeof code !== "string" ||
      typeof state !== "string" ||
      !req.session.kickOAuthState ||
      !safeEqual(state, req.session.kickOAuthState) ||
      !req.session.kickVerifier
    ) {
      return res.status(400).send("Invalid Kick OAuth state.");
    }

    delete req.session.kickOAuthState;

    const verifier = req.session.kickVerifier;
    delete req.session.kickVerifier;

    const token = await exchange(
      "https://id.kick.com/oauth/token",
      {
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.KICK_REDIRECT_URI,
        code_verifier: verifier
      }
    );

    const profileResponse = await fetch(
      "https://api.kick.com/public/v1/users",
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Client-Id": process.env.KICK_CLIENT_ID
        }
      }
    );

    if (!profileResponse.ok) {
      return res.status(502).send(
        "Kick authorized the connection, but profile lookup failed."
      );
    }

    const payload = await profileResponse.json();
    const profile = payload.data?.[0] || payload.data;

    if (!profile?.user_id && !profile?.id) {
      return res.status(502).send(
        "Kick did not return a usable channel identity."
      );
    }

    const id = String(profile.user_id || profile.id);

    await User.findByIdAndUpdate(
      req.session.userId,
      {
        $set: {
          "providers.kick.id": id,
          "providers.kick.username":
            profile.name || profile.username || profile.slug || "Kick channel",

          "providers.kick.accessToken": encryptSecret(token.access_token),
          "providers.kick.refreshToken": encryptSecret(token.refresh_token),

          "providers.kick.expiresAt": new Date(
            Date.now() + Number(token.expires_in || 0) * 1000
          ),

          "providers.kick.scopes": String(token.scope || "")
            .split(" ")
            .filter(Boolean),

          "providers.kick.connectedAt": new Date()
        }
      }
    );

    return res.redirect(dashboardRedirect("kick"));
  } catch (error) {
    console.error("[Rivo Kick OAuth]", error);

    return res.status(502).send(
      "Could not connect Kick. Please try again."
    );
  }
});

// --------------------------------------------------
// YOUTUBE CONNECTION
// --------------------------------------------------

router.get("/youtube", (req, res) => {
  if (!req.session.userId) {
    return loginRedirect(res);
  }

  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_REDIRECT_URI
  } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    return res.status(503).send(
      "YouTube connection is not configured yet."
    );
  }

  const state = stateFor(req, "youtubeOAuthState");

  const query = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state
  });

  res.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${query}`
  );
});

router.get("/youtube/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!req.session.userId) {
      return loginRedirect(res);
    }

    if (
      typeof code !== "string" ||
      typeof state !== "string" ||
      !req.session.youtubeOAuthState ||
      !safeEqual(state, req.session.youtubeOAuthState)
    ) {
      return res.status(400).send("Invalid Google OAuth state.");
    }

    delete req.session.youtubeOAuthState;

    const token = await exchange(
      "https://oauth2.googleapis.com/token",
      {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: process.env.GOOGLE_REDIRECT_URI
      }
    );

    const channelResponse = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`
        }
      }
    );

    if (!channelResponse.ok) {
      return res.status(502).send(
        "YouTube channel lookup failed."
      );
    }

    const payload = await channelResponse.json();
    const profile = payload.items?.[0];

    if (!profile) {
      return res.status(400).send(
        "No YouTube channel was found for this Google account."
      );
    }

    await User.findByIdAndUpdate(
      req.session.userId,
      {
        $set: {
          "providers.youtube.channelId": profile.id,
          "providers.youtube.title":
            profile.snippet?.title || "YouTube channel",

          "providers.youtube.accessToken": encryptSecret(token.access_token),
          "providers.youtube.refreshToken": encryptSecret(token.refresh_token),

          "providers.youtube.expiresAt": new Date(
            Date.now() + Number(token.expires_in || 0) * 1000
          ),

          "providers.youtube.scopes":
            token.scope?.split(" ") || [],

          "providers.youtube.connectedAt": new Date()
        }
      }
    );

    return res.redirect(dashboardRedirect("youtube"));
  } catch (error) {
    console.error("[Rivo YouTube OAuth]", error);

    return res.status(502).send(
      "Could not connect YouTube. Please try again."
    );
  }
});

// --------------------------------------------------
// LOGOUT
// --------------------------------------------------

router.post("/logout", (req, res, next) => {
  req.session.destroy(error => {
    if (error) {
      return next(error);
    }

    res.clearCookie("rivo.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite:
        process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/"
    });

    return res.json({ ok: true });
  });
});

export default router;
