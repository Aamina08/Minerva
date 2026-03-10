const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const authMiddleware = require("../middleware/authMiddleware");
const StudyGroup = require("../models/StudyGroup");
const User = require("../models/User");
const { getGroupSummary } = require("../services/groupAiService");

const router = express.Router();

const buildInviteCode = () => crypto.randomBytes(6).toString("hex");
const MAX_INVITE_ATTEMPTS = 5;

const normalizeMember = (user) => ({
  userId: user._id,
  name: user.name || "User",
  email: user.email || "",
  joinedAt: new Date(),
});

const ensureMember = (group, userId) =>
  group.members.some((member) => String(member.userId) === String(userId));

const generateUniqueInviteCode = async () => {
  for (let attempt = 0; attempt < MAX_INVITE_ATTEMPTS; attempt += 1) {
    const inviteCode = buildInviteCode();
    // Avoid rare invite collisions.
    const exists = await StudyGroup.exists({ inviteCode });
    if (!exists) return inviteCode;
  }
  throw new Error("Could not generate unique invite code.");
};

router.post("/", authMiddleware, async (req, res) => {
  try {
    const topic = String(req.body?.topic || "General Study Group").trim();
    const user = await User.findById(req.user.id).select("name email");

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const inviteCode = await generateUniqueInviteCode();
    const group = await StudyGroup.create({
      topic: topic || "General Study Group",
      inviteCode,
      createdBy: user._id,
      members: [normalizeMember(user)],
      messages: [],
      status: "active",
    });

    return res.status(201).json({
      group,
      inviteCode,
      inviteLink: `/join/${inviteCode}`,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create study group." });
  }
});

router.get("/join/:inviteCode", authMiddleware, async (req, res) => {
  try {
    const inviteCode = String(req.params.inviteCode || "").trim();
    const user = await User.findById(req.user.id).select("name email");

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const group = await StudyGroup.findOne({ inviteCode }).populate("createdBy", "name email");

    if (!group) {
      return res.status(404).json({ message: "Invite link is invalid." });
    }

    const alreadyMember = ensureMember(group, user._id);
    if (group.status !== "active" && !alreadyMember) {
      return res.status(400).json({ message: "This study group session has ended." });
    }

    if (!alreadyMember && group.status === "active") {
      group.members.push(normalizeMember(user));
      await group.save();
    }

    return res.json({ group });
  } catch (error) {
    return res.status(500).json({ message: "Failed to join study group." });
  }
});

router.get("/:groupId", authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ message: "Invalid group id." });
    }

    const group = await StudyGroup.findById(groupId).populate("createdBy", "name email");
    if (!group) {
      return res.status(404).json({ message: "Study group not found." });
    }

    const isMember = ensureMember(group, req.user.id);

    if (!isMember) {
      return res.status(403).json({ message: "You are not part of this study group." });
    }

    return res.json({ group });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch study group." });
  }
});

router.post("/:groupId/end", authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ message: "Invalid group id." });
    }

    const group = await StudyGroup.findById(groupId).populate("createdBy", "name email");
    if (!group) {
      return res.status(404).json({ message: "Study group not found." });
    }

    if (String(group.createdBy?._id || "") !== String(req.user.id)) {
      return res.status(403).json({ message: "Only the group creator can end the session." });
    }

    if (group.status === "ended") {
      return res.json({ summary: group.summary, group });
    }

    const summary = await getGroupSummary({ group, messages: group.messages || [] });

    group.status = "ended";
    group.endedAt = new Date();
    group.summary = summary;
    await group.save();

    return res.json({ summary, group });
  } catch (error) {
    return res.status(500).json({ message: "Failed to end study group session." });
  }
});

router.get("/:groupId/summary", authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ message: "Invalid group id." });
    }

    const group = await StudyGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Study group not found." });
    }

    if (!ensureMember(group, req.user.id)) {
      return res.status(403).json({ message: "You are not part of this study group." });
    }

    if (group.status !== "ended") {
      return res.status(400).json({ message: "Summary is available after the session ends." });
    }

    return res.json({
      summary: group.summary || {},
      groupId: group._id,
      topic: group.topic,
      endedAt: group.endedAt,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch summary." });
  }
});

module.exports = router;
