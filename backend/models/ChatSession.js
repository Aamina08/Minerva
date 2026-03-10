const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    size: { type: Number, default: 0 },
    type: { type: String, default: "" },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    attachments: { type: [attachmentSchema], default: [] },
  },
  { _id: false, timestamps: true }
);

const chatSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "New Chat" },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatSession", chatSessionSchema);
