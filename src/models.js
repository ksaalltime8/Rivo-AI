
import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// ==========================================
// USER
// ==========================================

const userSchema = new Schema(
  {
    email: {
      type: String,
      lowercase: true,
      trim: true,
      index: true
    },

    displayName: {
      type: String,
      trim: true
    },

    avatar: String,

    providers: {
      discord: {
        id: String,
        accessToken: String,
        refreshToken: String,
        connectedAt: Date
      },

      kick: {
        id: String,
        username: String,
        accessToken: String,
        refreshToken: String,
        expiresAt: Date,
        scopes: [String],
        connectedAt: Date
      },

      youtube: {
        channelId: String,
        title: String,
        accessToken: String,
        refreshToken: String,
        expiresAt: Date,
        scopes: [String],
        connectedAt: Date
      },

      // Legacy fields retained only to preserve and migrate existing records.
      // Twitch is not an active Rivo integration.
      twitch: {
        id: String,
        username: String,
        accessToken: String,
        refreshToken: String,
        expiresAt: Date,
        scopes: [String],
        connectedAt: Date
      }
    }
  },
  {
    timestamps: true
  }
);

// ==========================================
// INSTALLATIONS
// ==========================================

const installationSchema = new Schema(
  {
    provider: {
      type: String,
      enum: ["discord", "kick"],
      required: true,
      index: true
    },

    externalId: {
      type: String,
      required: true
    },

    name: String,

    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "RivoUser",
      index: true
    },

    enabled: {
      type: Boolean,
      default: true
    },

    lastSeenAt: Date,

    settings: {
      type: Schema.Types.Mixed,
      default: {
        welcome: { enabled: false },
        automod: { enabled: false },
        logs: { enabled: false },
        leveling: { enabled: false },
        alerts: { enabled: false },
        tickets: { enabled: false },
        economy: { enabled: false }
      }
    }
  },
  {
    timestamps: true
  }
);

installationSchema.index(
  {
    provider: 1,
    externalId: 1
  },
  {
    unique: true
  }
);

// ==========================================
// SERVICE HEARTBEATS
// ==========================================

const heartbeatSchema = new Schema(
  {
    service: {
      type: String,
      index: true
    },

    instanceId: String,

    status: String,

    metadata: Schema.Types.Mixed,

    seenAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  }
);

// ==========================================
// AUDIT LOGS
// ==========================================

const auditSchema = new Schema(
  {
    actor: String,

    action: String,

    target: String,

    ip: String,

    details: Schema.Types.Mixed
  },
  {
    timestamps: true
  }
);

// ==========================================
// WEBHOOK RECEIPTS
// ==========================================

const webhookReceiptSchema = new Schema(
  {
    provider: String,

    messageId: {
      type: String,
      unique: true
    },

    eventType: String,

    receivedAt: {
      type: Date,
      default: Date.now
    },

    payload: Schema.Types.Mixed
  }
);

// ==========================================
// FEATURE CATALOG
// ==========================================

const featureSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 90
    },

    slug: {
      type: String,
      required: true,
      unique: true
    },

    category: {
      type: String,
      default: "Community",
      maxlength: 40
    },

    description: {
      type: String,
      required: true,
      maxlength: 600
    },

    status: {
      type: String,
      enum: ["available", "beta", "coming_soon"],
      default: "coming_soon"
    },

    highlights: {
      type: [String],
      default: []
    },

    visible: {
      type: Boolean,
      default: true
    },

    sortOrder: {
      type: Number,
      default: 0
    },

    icon: {
      type: String,
      default: "✦",
      maxlength: 8
    }
  },
  {
    timestamps: true
  }
);

// ==========================================
// MODEL EXPORTS
// ==========================================

export const User =
  models.RivoUser ||
  model("RivoUser", userSchema);

export const Installation =
  models.RivoInstallation ||
  model("RivoInstallation", installationSchema);

export const ServiceHeartbeat =
  models.RivoServiceHeartbeat ||
  model(
    "RivoServiceHeartbeat",
    heartbeatSchema,
    "rivoserviceheartbeats"
  );

export const AuditLog =
  models.RivoAuditLog ||
  model("RivoAuditLog", auditSchema);

export const WebhookReceipt =
  models.RivoWebhookReceipt ||
  model("RivoWebhookReceipt", webhookReceiptSchema);

export const FeatureEntry =
  models.RivoFeatureEntry ||
  model("RivoFeatureEntry", featureSchema);
