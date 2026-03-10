const mongoose = require("mongoose");

const groupMemberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, required: true },
    email: { type: String, default: "" },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const groupMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    userName: { type: String, default: "" },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const groupSummarySchema = new mongoose.Schema(
  {
    topicsDiscussed: { type: [String], default: [] },
    whoAskedWhat: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, required: true },
            questions: { type: [String], default: [] },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    practiceProblemsSolved: { type: [String], default: [] },
    keyTakeaways: { type: [String], default: [] },
    generatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const studyGroupSchema = new mongoose.Schema(
  {
    topic: { type: String, default: "General Study Group" },
    inviteCode: { type: String, required: true, unique: true, index: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: { type: [groupMemberSchema], default: [] },
    messages: { type: [groupMessageSchema], default: [] },
    status: {
      type: String,
      enum: ["active", "ended"],
      default: "active",
      index: true,
    },
    endedAt: { type: Date, default: null },
    summary: { type: groupSummarySchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StudyGroup", studyGroupSchema);
