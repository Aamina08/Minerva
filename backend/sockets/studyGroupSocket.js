const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const StudyGroup = require("../models/StudyGroup");
const User = require("../models/User");
const { getGroupAiReply } = require("../services/groupAiService");

const JWT_SECRET = process.env.JWT_SECRET || "secretkey123";
const MAX_GROUP_MESSAGE_LENGTH = Number(process.env.MAX_GROUP_MESSAGE_LENGTH || 2000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.GROUP_RATE_LIMIT_WINDOW_MS || 10000);
const RATE_LIMIT_MAX_MESSAGES = Number(process.env.GROUP_RATE_LIMIT_MAX_MESSAGES || 8);

const activeGroupMembers = new Map();
const messageRateMap = new Map();

const getGroupRoom = (groupId) => `study-group:${groupId}`;

const addPresence = ({ groupId, userId, name, socketId }) => {
  if (!activeGroupMembers.has(groupId)) {
    activeGroupMembers.set(groupId, new Map());
  }
  const groupMap = activeGroupMembers.get(groupId);
  if (!groupMap.has(userId)) {
    groupMap.set(userId, { userId, name, sockets: new Set() });
  }
  groupMap.get(userId).sockets.add(socketId);
};

const removePresenceBySocket = (socketId) => {
  for (const [groupId, groupMap] of activeGroupMembers.entries()) {
    for (const [userId, userEntry] of groupMap.entries()) {
      if (userEntry.sockets.has(socketId)) {
        userEntry.sockets.delete(socketId);
        if (userEntry.sockets.size === 0) {
          groupMap.delete(userId);
        }
        if (groupMap.size === 0) {
          activeGroupMembers.delete(groupId);
        }
        return groupId;
      }
    }
  }
  return "";
};

const serializeOnline = (groupId) => {
  const groupMap = activeGroupMembers.get(groupId);
  if (!groupMap) return [];
  return Array.from(groupMap.values()).map((entry) => ({
    userId: entry.userId,
    name: entry.name,
  }));
};

const getRateKey = (groupId, userId) => `${groupId}:${userId}`;

const isRateLimited = (groupId, userId) => {
  const now = Date.now();
  const key = getRateKey(groupId, userId);
  const history = messageRateMap.get(key) || [];
  const recent = history.filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  messageRateMap.set(key, recent);
  return recent.length > RATE_LIMIT_MAX_MESSAGES;
};

const setupStudyGroupSocket = (io) => {
  io.on("connection", (socket) => {
    socket.on("study-group:join", async (payload = {}) => {
      try {
        const tokenRaw =
          payload.token || socket.handshake.auth?.token || socket.handshake.headers?.authorization || "";
        const token = String(tokenRaw).replace(/^Bearer\s+/i, "").trim();
        if (!token) {
          socket.emit("study-group:error", { message: "Missing auth token." });
          return;
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id).select("name email");
        if (!user) {
          socket.emit("study-group:error", { message: "User not found." });
          return;
        }

        const groupId = String(payload.groupId || "").trim();
        if (!mongoose.Types.ObjectId.isValid(groupId)) {
          socket.emit("study-group:error", { message: "Invalid group id." });
          return;
        }

        const group = await StudyGroup.findById(groupId);
        if (!group) {
          socket.emit("study-group:error", { message: "Study group not found." });
          return;
        }
        if (group.status !== "active") {
          socket.emit("study-group:error", { message: "This study group has ended." });
          return;
        }

        const isMember = group.members.some((member) => String(member.userId) === String(user._id));
        if (!isMember) {
          socket.emit("study-group:error", {
            message: "Not authorized for this group. Join via invite link first.",
          });
          return;
        }

        const room = getGroupRoom(groupId);
        socket.join(room);
        socket.data.groupId = groupId;
        socket.data.userId = String(user._id);
        socket.data.userName = user.name || "User";

        addPresence({
          groupId,
          userId: String(user._id),
          name: user.name || "User",
          socketId: socket.id,
        });

        io.to(room).emit("study-group:presence", {
          groupId,
          onlineUsers: serializeOnline(groupId),
        });
      } catch (error) {
        socket.emit("study-group:error", { message: "Unable to join study group realtime channel." });
      }
    });

    socket.on("study-group:message", async (payload = {}) => {
      try {
        const groupId = String(payload.groupId || socket.data.groupId || "").trim();
        const userId = String(socket.data.userId || "").trim();
        const userName = String(socket.data.userName || "User").trim();
        const text = String(payload.message || "").trim();

        if (!groupId || !userId || !text) return;
        if (text.length > MAX_GROUP_MESSAGE_LENGTH) {
          socket.emit("study-group:error", {
            message: `Message too long. Max ${MAX_GROUP_MESSAGE_LENGTH} characters.`,
          });
          return;
        }
        if (isRateLimited(groupId, userId)) {
          socket.emit("study-group:error", {
            message: "Rate limit exceeded. Please slow down.",
          });
          return;
        }

        const group = await StudyGroup.findById(groupId);
        if (!group || group.status !== "active") {
          socket.emit("study-group:error", { message: "Study group is not active." });
          return;
        }

        const memberExists = group.members.some(
          (member) => String(member.userId) === userId
        );
        if (!memberExists) {
          socket.emit("study-group:error", { message: "You are not a member of this study group." });
          return;
        }

        const userMessage = {
          role: "user",
          userId,
          userName,
          content: text,
          createdAt: new Date(),
        };

        group.messages.push(userMessage);
        await group.save();

        const room = getGroupRoom(groupId);
        io.to(room).emit("study-group:message", {
          groupId,
          message: {
            role: "user",
            userId,
            userName,
            content: text,
            createdAt: userMessage.createdAt,
          },
        });

        const aiReply = await getGroupAiReply({
          topic: group.topic,
          participants: group.members,
          history: group.messages,
          userName,
          userText: text,
        });

        const assistantMessage = {
          role: "assistant",
          userId: null,
          userName: "AI Tutor",
          content: aiReply,
          createdAt: new Date(),
        };

        group.messages.push(assistantMessage);
        await group.save();

        io.to(room).emit("study-group:message", {
          groupId,
          message: assistantMessage,
        });
      } catch (error) {
        socket.emit("study-group:error", { message: "Failed to send group message." });
      }
    });

    socket.on("disconnect", () => {
      const groupId = removePresenceBySocket(socket.id);
      const userId = String(socket.data.userId || "");
      if (groupId && userId) {
        messageRateMap.delete(getRateKey(groupId, userId));
      }
      if (!groupId) return;
      io.to(getGroupRoom(groupId)).emit("study-group:presence", {
        groupId,
        onlineUsers: serializeOnline(groupId),
      });
    });
  });
};

module.exports = {
  setupStudyGroupSocket,
};
