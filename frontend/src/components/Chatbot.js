import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import "./Chatbot.css";

const MAX_TEXT_ATTACHMENT_CHARS = 12000;
const MAX_IMAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 70000;
const TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".cs",
  ".go",
  ".php",
  ".rb",
  ".sql",
  ".yaml",
  ".yml",
];

const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const parseStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch (error) {
    return null;
  }
};

const readFileAsText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read file as text."));
    reader.readAsText(file);
  });

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read file as image."));
    reader.readAsDataURL(file);
  });

const hasTextLikeMime = (type) =>
  type.startsWith("text/") ||
  type.includes("json") ||
  type.includes("xml") ||
  type.includes("javascript");

const hasTextLikeExtension = (name) => {
  const lower = name.toLowerCase();
  return TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

const buildAttachmentPayload = async (file) => {
  const payload = {
    name: file.name,
    size: file.size,
    type: file.type,
  };

  if (file.type.startsWith("image/")) {
    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      return {
        ...payload,
        extractionError: `Image too large (${formatBytes(file.size)}). Max ${formatBytes(
          MAX_IMAGE_ATTACHMENT_BYTES
        )}.`,
      };
    }

    const dataUrl = await readFileAsDataUrl(file);
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
    return {
      ...payload,
      imageBase64: base64,
    };
  }

  if (hasTextLikeMime(file.type) || hasTextLikeExtension(file.name)) {
    const content = await readFileAsText(file);
    return {
      ...payload,
      textContent: content.slice(0, MAX_TEXT_ATTACHMENT_CHARS),
      textTruncated: content.length > MAX_TEXT_ATTACHMENT_CHARS,
    };
  }

  return payload;
};

const normalizeAssistantReply = (reply) => {
  const text = (reply || "").trim();
  if (!text) return "I could not generate a response. Please try again.";

  return text;
};

const buildClientQuickReply = (message) => {
  const text = (message || "").trim();
  const lower = text.toLowerCase();

  if (!text) return "Please type your question and I will help.";
  if (lower.includes("array") && lower.includes("java")) {
    return "In Java, an array stores multiple values of the same type in a fixed-size structure. Example: `int[] nums = {1, 2, 3};` Access values with index like `nums[0]`. Arrays are zero-indexed.";
  }
  if (["hi", "hii", "hello", "hey"].includes(lower)) {
    return "Hi. Tell me what you want to learn, and I will explain clearly.";
  }
  return `I could not reach the AI server in time. Quick response: ${text}`;
};

const SOCKET_BASE_URL = process.env.REACT_APP_SOCKET_URL || "http://localhost:5000";
const SEND_FALLBACK_TEXT = "I'm having trouble connecting. Please try again.";

const escapePdfText = (value) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const buildPdfBlobFromLines = (lines) => {
  const safeLines = lines.slice(0, 120);
  const textOps = safeLines
    .map((line, index) => {
      const y = 800 - index * 14;
      return `1 0 0 1 42 ${Math.max(30, y)} Tm (${escapePdfText(line)}) Tj`;
    })
    .join("\n");
  const stream = `BT\n/F1 11 Tf\n14 TL\n${textOps}\nET`;

  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(pdf.length);
    pdf += `${obj}\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
};

const buildSummaryLines = ({ topic, summary }) => {
  const lines = [
    "Study Group Session Summary",
    `Topic: ${topic || "General Study Group"}`,
    `Generated at: ${new Date().toLocaleString()}`,
    "",
    "Topics Discussed:",
    ...(summary?.topicsDiscussed?.length
      ? summary.topicsDiscussed.map((item, index) => `${index + 1}. ${item}`)
      : ["1. No topics detected"]),
    "",
    "Who Asked What:",
    ...(summary?.whoAskedWhat?.length
      ? summary.whoAskedWhat.flatMap((entry) => [
          `${entry.name}:`,
          ...(entry.questions || []).map((q, index) => `  - Q${index + 1}: ${q}`),
        ])
      : ["No user questions were recorded"]),
    "",
    "Practice Problems Solved:",
    ...(summary?.practiceProblemsSolved?.length
      ? summary.practiceProblemsSolved.map((item, index) => `${index + 1}. ${item}`)
      : ["No explicit practice problems captured"]),
    "",
    "Key Takeaways:",
    ...(summary?.keyTakeaways?.length
      ? summary.keyTakeaways.map((item, index) => `${index + 1}. ${item}`)
      : ["No key takeaways generated"]),
  ];

  return lines;
};

function Chatbot() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState("");
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [hoveredSessionId, setHoveredSessionId] = useState("");
  const [touchOptionsSessionId, setTouchOptionsSessionId] = useState("");
  const [menuSessionId, setMenuSessionId] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [pinnedSessionIds, setPinnedSessionIds] = useState([]);
  const [activeStudyGroup, setActiveStudyGroup] = useState(null);
  const [groupOnlineUsers, setGroupOnlineUsers] = useState([]);
  const [groupInviteLink, setGroupInviteLink] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [isEndingGroupSession, setIsEndingGroupSession] = useState(false);
  const [isDownloadingSummary, setIsDownloadingSummary] = useState(false);
  const fileInputRef = useRef(null);
  const chatBodyRef = useRef(null);
  const longPressTimeoutRef = useRef(null);
  const groupSocketRef = useRef(null);

  const activeUser = useMemo(() => {
    return user || parseStoredUser() || null;
  }, [user]);

  const displayName = useMemo(() => {
    return (activeUser?.name || "User").trim();
  }, [activeUser]);

  const displayEmail = useMemo(() => {
    return (activeUser?.email || "Logged in user").trim();
  }, [activeUser]);

  const displayInitials = useMemo(() => {
    const parts = displayName.split(" ").filter(Boolean);
    if (parts.length === 0) return "U";
    return parts
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }, [displayName]);

  const isGroupCreator = useMemo(() => {
    const creatorId =
      activeStudyGroup?.createdBy?._id ||
      activeStudyGroup?.createdBy ||
      "";
    return String(creatorId) === String(activeUser?._id || "");
  }, [activeStudyGroup?.createdBy, activeUser?._id]);

  const orderedSessions = useMemo(() => {
    const pinnedSet = new Set(pinnedSessionIds);
    const pinned = sessions.filter((session) => pinnedSet.has(session._id));
    const unpinned = sessions.filter((session) => !pinnedSet.has(session._id));
    return [...pinned, ...unpinned];
  }, [sessions, pinnedSessionIds]);

  const groupedSessions = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayMs = 24 * 60 * 60 * 1000;
    const groups = new Map();

    const getDayLabel = (diffDays) => {
      if (diffDays <= 0) return "Today";
      if (diffDays === 1) return "Yesterday";
      return `${diffDays} days ago`;
    };

    orderedSessions.forEach((session) => {
      const sessionDate = new Date(session.createdAt || session.updatedAt || Date.now());
      const sessionDay = new Date(
        sessionDate.getFullYear(),
        sessionDate.getMonth(),
        sessionDate.getDate()
      );
      const diffDays = Math.floor((startOfToday - sessionDay) / dayMs);
      const safeDiffDays = Math.max(0, diffDays);
      const label = getDayLabel(safeDiffDays);

      if (!groups.has(safeDiffDays)) {
        groups.set(safeDiffDays, { label, items: [] });
      }
      groups.get(safeDiffDays).items.push(session);
    });

    return Array.from(groups.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, group]) => group);
  }, [orderedSessions]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pinnedSessionIds") || "[]");
      if (Array.isArray(saved)) {
        setPinnedSessionIds(saved);
      }
    } catch {
      setPinnedSessionIds([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("pinnedSessionIds", JSON.stringify(pinnedSessionIds));
  }, [pinnedSessionIds]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".history-options-wrap")) {
        setMenuSessionId("");
      }
      if (!target.closest(".profile-menu-wrap")) {
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, []);

  useEffect(() => () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
    }
  }, []);

  const togglePinSession = (sessionId) => {
    setPinnedSessionIds((prev) =>
      prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [sessionId, ...prev]
    );
    setMenuSessionId("");
  };

  const handleLogout = () => {
    setProfileMenuOpen(false);
    logout();
    navigate("/");
  };

  const renameSession = (session) => {
    const nextTitle = window.prompt("Rename chat", session.title || "New Chat");
    if (!nextTitle) {
      setMenuSessionId("");
      return;
    }

    const cleanTitle = nextTitle.trim();
    if (!cleanTitle) {
      setMenuSessionId("");
      return;
    }

    setSessions((prev) =>
      prev.map((item) =>
        item._id === session._id ? { ...item, title: cleanTitle } : item
      )
    );
    setMenuSessionId("");
  };

  const deleteSession = async (sessionId) => {
    const confirmed = window.confirm("Delete this chat permanently?");
    if (!confirmed) {
      setMenuSessionId("");
      return;
    }

    try {
      await api.delete(`/chat/sessions/${sessionId}`);
      const { data } = await api.get("/chat/sessions");
      const refreshedSessions = data?.sessions || [];
      const remaining = refreshedSessions.filter((session) => session._id !== sessionId);

      setSessions(refreshedSessions);
      setPinnedSessionIds((prev) => prev.filter((id) => id !== sessionId));
      setMenuSessionId("");
      setError("");

      if (activeSessionId === sessionId) {
        if (remaining.length > 0) {
          await openSession(remaining[0]._id);
        } else {
          await createNewChat();
        }
      }
    } catch (err) {
      const deleteError = err.response?.data?.message || "Failed to delete chat.";
      setError(deleteError);
      window.alert(deleteError);
      setMenuSessionId("");
    }
  };

  const shareSession = async (session) => {
    const shareText = `${window.location.origin}/chat/${session._id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: session.title, text: shareText, url: shareText });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        setError("Share link copied to clipboard.");
      } else {
        setError(`Share link: ${shareText}`);
      }
    } catch {
      setError("Unable to share this chat right now.");
    } finally {
      setMenuSessionId("");
    }
  };

  const handleLongPressStart = (sessionId) => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
    }

    longPressTimeoutRef.current = setTimeout(() => {
      setTouchOptionsSessionId(sessionId);
    }, 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const openSession = useCallback(async (sessionId) => {
    try {
      if (groupSocketRef.current) {
        groupSocketRef.current.disconnect();
        groupSocketRef.current = null;
      }
      setActiveStudyGroup(null);
      setGroupOnlineUsers([]);

      const { data } = await api.get(`/chat/sessions/${sessionId}`);
      const session = data?.session;
      if (!session) return;

      setActiveSessionId(session._id);
      setMenuSessionId("");
      const normalized = (session.messages || []).map((msg) => ({
        sender: msg.role === "assistant" ? "bot" : "user",
        text: msg.content,
        attachments: msg.attachments || [],
      }));
      setMessages(normalized);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to open chat.");
    }
  }, []);

  const createNewChat = useCallback(async () => {
    if (groupSocketRef.current) {
      groupSocketRef.current.disconnect();
      groupSocketRef.current = null;
    }
    setActiveStudyGroup(null);
    setGroupOnlineUsers([]);

    if (!historyEnabled) {
      setMessages([]);
      setSelectedFiles([]);
      setInput("");
      setError("");
      return;
    }

    try {
      const { data } = await api.post("/chat/sessions", { title: "New Chat" });
      const newSession = data?.session;
      if (!newSession) return;

      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession._id);
      setMenuSessionId("");
      setMessages([]);
      setSelectedFiles([]);
      setInput("");
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create new chat.");
    }
  }, [historyEnabled]);

  const ensureActiveSessionForSend = useCallback(async () => {
    if (!historyEnabled) return "";
    if (activeSessionId) return activeSessionId;

    const { data } = await api.post("/chat/sessions", { title: "New Chat" });
    const created = data?.session;
    if (!created?._id) return "";

    setSessions((prev) => [created, ...prev]);
    setActiveSessionId(created._id);
    return created._id;
  }, [activeSessionId, historyEnabled]);

  const normalizeGroupMessages = useCallback(
    (groupMessages = []) =>
      groupMessages.map((entry) => ({
        sender: entry.role === "assistant" ? "bot" : "user",
        text: entry.content,
        userName: entry.userName || "",
        userId: entry.userId || "",
        isGroup: true,
        isSelf:
          entry.role !== "assistant" &&
          String(entry.userId || "") === String(activeUser?._id || ""),
        attachments: [],
      })),
    [activeUser?._id]
  );

  const setupStudyGroupSocket = useCallback(
    (group) => {
      if (!group?._id) return;

      if (groupSocketRef.current) {
        groupSocketRef.current.disconnect();
        groupSocketRef.current = null;
      }

      const token = localStorage.getItem("token");
      if (!token) return;

      const socket = io(SOCKET_BASE_URL, {
        transports: ["websocket"],
      });

      socket.on("connect", () => {
        socket.emit("study-group:join", {
          groupId: group._id,
          token,
        });
      });

      socket.on("study-group:presence", (payload) => {
        if (payload?.groupId !== group._id) return;
        setGroupOnlineUsers(payload.onlineUsers || []);
      });

      socket.on("study-group:message", (payload) => {
        if (payload?.groupId !== group._id || !payload?.message) return;
        const msg = payload.message;
        setMessages((prev) => [
          ...prev,
          {
            sender: msg.role === "assistant" ? "bot" : "user",
            text: msg.content || "",
            userName: msg.userName || "",
            userId: msg.userId || "",
            isGroup: true,
            isSelf:
              msg.role !== "assistant" &&
              String(msg.userId || "") === String(activeUser?._id || ""),
            attachments: [],
          },
        ]);
        setLoading(false);
      });

      socket.on("study-group:error", (payload) => {
        const message = payload?.message || "Study group realtime error.";
        setError(message);
        if (message.toLowerCase().includes("ended")) {
          setActiveStudyGroup((prev) => (prev ? { ...prev, status: "ended" } : prev));
        }
        setLoading(false);
      });

      groupSocketRef.current = socket;
    },
    [activeUser?._id]
  );

  const joinStudyGroupByInvite = useCallback(
    async (inviteCode) => {
      try {
        const { data } = await api.get(`/study-groups/join/${inviteCode}`);
        const group = data?.group;
        if (!group) return;

        setActiveStudyGroup(group);
        setGroupInviteLink(`${window.location.origin}/join/${group.inviteCode}`);
        setCopyNotice("");
        setMessages(normalizeGroupMessages(group.messages || []));
        setError("");
        setInput("");
        setSelectedFiles([]);
        if (group.status === "active") {
          setupStudyGroupSocket(group);
        } else if (groupSocketRef.current) {
          groupSocketRef.current.disconnect();
          groupSocketRef.current = null;
        }
      } catch (err) {
        setError(err.response?.data?.message || "Failed to join study group.");
      }
    },
    [normalizeGroupMessages, setupStudyGroupSocket]
  );

  const createStudyGroup = async () => {
    const topic = window.prompt("Enter a topic name for this study group", "General Study Group");
    if (topic === null) return;

    try {
      const { data } = await api.post("/study-groups", { topic });
      const group = data?.group;
      if (!group) return;

      setActiveStudyGroup(group);
      const invite = `${window.location.origin}${data.inviteLink || `/join/${group.inviteCode}`}`;
      setGroupInviteLink(invite);
      setCopyNotice("");
      setMessages([]);
      setError("");
      setInput("");
      setSelectedFiles([]);
      setupStudyGroupSocket(group);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create study group.");
    }
  };

  const copyGroupInviteLink = async () => {
    if (!groupInviteLink) return;

    const fallbackCopy = () => {
      const textArea = document.createElement("textarea");
      textArea.value = groupInviteLink;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      document.body.removeChild(textArea);
      return copied;
    };

    try {
      let copied = false;
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(groupInviteLink);
        copied = true;
      } else {
        copied = fallbackCopy();
      }

      if (!copied) {
        throw new Error("Copy command failed");
      }
      setCopyNotice("Link copied!");
      setTimeout(() => setCopyNotice(""), 2200);
      setError("");
    } catch {
      setCopyNotice("Copy failed. Please copy manually.");
      setTimeout(() => setCopyNotice(""), 2800);
    }
  };

  const endStudyGroupSession = async () => {
    if (!activeStudyGroup?._id || isEndingGroupSession) return;
    const confirmed = window.confirm("End this study group and generate summary?");
    if (!confirmed) return;

    try {
      setIsEndingGroupSession(true);
      const { data } = await api.post(`/study-groups/${activeStudyGroup._id}/end`);
      const summary = data?.summary || {};
      const lines = buildSummaryLines({
        topic: activeStudyGroup.topic,
        summary,
      });
      const blob = buildPdfBlobFromLines(lines);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(activeStudyGroup.topic || "study-group").replace(/\s+/g, "-").toLowerCase()}-summary.pdf`;
      link.click();
      URL.revokeObjectURL(url);

      if (groupSocketRef.current) {
        groupSocketRef.current.disconnect();
        groupSocketRef.current = null;
      }

      setGroupOnlineUsers([]);
      setActiveStudyGroup((prev) => (prev ? { ...prev, status: "ended", summary } : prev));
      setError("Study group ended and summary downloaded.");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to end study group.");
    } finally {
      setIsEndingGroupSession(false);
    }
  };

  const downloadStudyGroupSummary = async () => {
    if (!activeStudyGroup?._id || isDownloadingSummary) return;

    try {
      setIsDownloadingSummary(true);
      const { data } = await api.get(`/study-groups/${activeStudyGroup._id}/summary`);
      const summary = data?.summary || {};
      const lines = buildSummaryLines({
        topic: data?.topic || activeStudyGroup.topic,
        summary,
      });
      const blob = buildPdfBlobFromLines(lines);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(data?.topic || activeStudyGroup.topic || "study-group").replace(/\s+/g, "-").toLowerCase()}-summary.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setError("Summary downloaded.");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to download summary.");
    } finally {
      setIsDownloadingSummary(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        setInitializing(true);
        const { data } = await api.get("/chat/sessions");
        const sessionList = data?.sessions || [];
        setSessions(sessionList);
        setHistoryEnabled(true);

        if (sessionList.length > 0) {
          await openSession(sessionList[0]._id);
        } else {
          await createNewChat();
        }
      } catch (err) {
        setHistoryEnabled(false);
        setSessions([]);
        setActiveSessionId("");
        setError("Chat history unavailable. You can still chat.");
      } finally {
        setInitializing(false);
      }
    };

    load();
  }, [openSession, createNewChat]);

  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get("groupInvite");
    if (!inviteCode) return;
    joinStudyGroupByInvite(inviteCode);
  }, [joinStudyGroupByInvite]);

  useEffect(
    () => () => {
      if (groupSocketRef.current) {
        groupSocketRef.current.disconnect();
      }
    },
    []
  );

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if ((!trimmedInput && selectedFiles.length === 0) || loading) return;

    const messageToSend =
      trimmedInput || "Please analyze the attached files and help me.";
    setError("");

    if (activeStudyGroup?._id) {
      if (activeStudyGroup.status === "ended") {
        setError("This study group session has ended. Download the summary.");
        return;
      }
      if (!trimmedInput) {
        setError("Please type a message for group chat.");
        return;
      }
      if (!groupSocketRef.current) {
        setError("Realtime connection unavailable. Rejoin the study group.");
        return;
      }

      setInput("");
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setLoading(true);
      groupSocketRef.current.emit("study-group:message", {
        groupId: activeStudyGroup._id,
        message: trimmedInput,
      });
      return;
    }

    try {
      const attachments = await Promise.all(
        selectedFiles.map(async (file) => {
          try {
            return await buildAttachmentPayload(file);
          } catch (error) {
            return {
              name: file.name,
              size: file.size,
              type: file.type,
              extractionError: "Could not extract this file.",
            };
          }
        })
      );

      const userMsg = {
        sender: "user",
        text: trimmedInput || "Attached files",
        attachments,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setLoading(true);

      const sessionIdForSend = await ensureActiveSessionForSend();
      let data;

      if (historyEnabled && sessionIdForSend) {
        try {
          const response = await api.post(
            `/chat/sessions/${sessionIdForSend}/messages`,
            {
              message: messageToSend,
              attachments,
            },
            { timeout: REQUEST_TIMEOUT_MS }
          );
          data = response.data;
        } catch (sessionErr) {
          throw sessionErr;
        }
      } else {
        const response = await api.post("/chat", {
          message: messageToSend,
        }, { timeout: REQUEST_TIMEOUT_MS });
        data = response.data;
      }

      const botMsg = {
        sender: "bot",
        text: normalizeAssistantReply(data.reply || "No response from AI."),
        attachments: [],
      };

      setMessages((prev) => [...prev, botMsg]);
      if (historyEnabled && data?.session) {
        setSessions((prev) => {
          const rest = prev.filter((item) => item._id !== data.session._id);
          return [data.session, ...rest];
        });
      }
      setError("");
    } catch (error) {
      const timedOut =
        error?.code === "ECONNABORTED" ||
        String(error?.message || "").toLowerCase().includes("timeout");
      const backendErrorText =
        error.response?.data?.reply ||
        error.response?.data?.message ||
        (timedOut
          ? buildClientQuickReply(messageToSend)
          : SEND_FALLBACK_TEXT);
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: backendErrorText,
          attachments: [],
        },
      ]);
      setError(backendErrorText);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectFiles = (event) => {
    const files = Array.from(event.target.files || []);
    setSelectedFiles(files);
  };

  const removeFile = (name) => {
    setSelectedFiles((prev) => prev.filter((file) => file.name !== name));
  };

  const renderAttachments = (attachments) => {
    if (!attachments || attachments.length === 0) return null;

    return (
      <div className="attachment-list">
        {attachments.map((file, idx) => (
          <div key={`${file.name}-${idx}`} className="attachment-item">
            <span>{file.name}</span>
            <small>{formatBytes(file.size)}</small>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="ai-shell">
      <aside className="ai-sidebar">
        <div className="sidebar-top-actions">
          <button className="new-chat-btn" onClick={createNewChat}>
            + New Chat
          </button>
          <button className="create-group-btn" onClick={createStudyGroup}>
            + Create Study Group
          </button>
        </div>

        {activeStudyGroup && (
          <div className="study-group-card">
            <p className="study-group-title">{activeStudyGroup.topic || "Study Group"}</p>
            <p className="study-group-meta">
              Status: {activeStudyGroup.status || "active"} | Online: {groupOnlineUsers.length}
            </p>
            {groupInviteLink && (
              <div className="study-group-invite">
                <input type="text" value={groupInviteLink} readOnly />
                <button type="button" onClick={copyGroupInviteLink}>
                  Copy
                </button>
              </div>
            )}
            {copyNotice && <p className="copy-notice">{copyNotice}</p>}
            {isGroupCreator && (
              <button
                className="end-group-btn"
                onClick={endStudyGroupSession}
                disabled={isEndingGroupSession || activeStudyGroup.status === "ended"}
              >
                {isEndingGroupSession ? "Ending..." : "End Session + Summary PDF"}
              </button>
            )}
            {activeStudyGroup.status === "ended" && (
              <button
                className="end-group-btn"
                onClick={downloadStudyGroupSummary}
                disabled={isDownloadingSummary}
              >
                {isDownloadingSummary ? "Preparing PDF..." : "Download Summary PDF"}
              </button>
            )}
          </div>
        )}

        <div className="history-title">Chat History</div>
        <div className="history-list">
          {historyEnabled && orderedSessions.length === 0 && !initializing && (
            <p className="history-empty">No chats yet</p>
          )}
          {!historyEnabled && (
            <p className="history-empty">History not available</p>
          )}
          {groupedSessions.map((group) => (
            <div key={group.label} className="history-group">
              <p className="history-group-title">{group.label}</p>
              {group.items.map((session) => {
                const showOptions =
                  hoveredSessionId === session._id ||
                  touchOptionsSessionId === session._id ||
                  menuSessionId === session._id;
                const isPinned = pinnedSessionIds.includes(session._id);
                const isMenuOpen = menuSessionId === session._id;

                return (
                  <div
                    key={session._id}
                    className={`history-item-row ${activeSessionId === session._id ? "active" : ""} ${isMenuOpen ? "menu-open" : ""}`}
                    onMouseEnter={() => setHoveredSessionId(session._id)}
                    onMouseLeave={() => setHoveredSessionId("")}
                    onTouchStart={() => handleLongPressStart(session._id)}
                    onTouchEnd={handleLongPressEnd}
                    onTouchCancel={handleLongPressEnd}
                  >
                    <button
                      className={`history-item ${activeSessionId === session._id ? "active" : ""}`}
                      onClick={() => {
                        openSession(session._id);
                        setTouchOptionsSessionId("");
                      }}
                    >
                      <span className="history-item-text">
                        {isPinned && <span className="history-pin-mark">[Pinned] </span>}
                        {session.title}
                      </span>
                    </button>

                    <div
                      className="history-options-wrap"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className={`history-options-btn ${showOptions ? "visible" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuSessionId((prev) => (prev === session._id ? "" : session._id));
                          setTouchOptionsSessionId(session._id);
                        }}
                        aria-label="More options"
                      >
                        {"\u22EE"}
                      </button>

                      {menuSessionId === session._id && (
                        <div
                          className="history-options-menu"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button type="button" onClick={() => renameSession(session)}>
                            Rename
                          </button>
                          <button type="button" onClick={() => deleteSession(session._id)}>
                            Delete
                          </button>
                          <button type="button" onClick={() => shareSession(session)}>
                            Share
                          </button>
                          <button type="button" onClick={() => togglePinSession(session._id)}>
                            {isPinned ? "Unpin Chat" : "Pin Chat"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="sidebar-profile">
          <div className="profile-avatar">{displayInitials}</div>
          <div className="profile-meta">
            <p className="profile-name">{displayName}</p>
            <p className="profile-email">{displayEmail}</p>
          </div>
          <div className="profile-menu-wrap" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={`profile-menu-btn ${profileMenuOpen ? "visible" : ""}`}
              onClick={() => setProfileMenuOpen((prev) => !prev)}
              aria-label="Profile options"
            >
              {"\u22EE"}
            </button>
            {profileMenuOpen && (
              <div className="profile-options-menu">
                <button type="button" onClick={handleLogout}>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className="ai-main">
        <header className="ai-header">
          <h2>
            {activeStudyGroup
              ? `Study Group: ${activeStudyGroup.topic || "General Study Group"}`
              : `Welcome back, ${displayName}!`}
          </h2>
          <p>
            {activeStudyGroup
              ? activeStudyGroup.status === "ended"
                ? "This study group session has ended. Summary is available for members."
                : "Collaborative AI chat is active. Everyone sees the same discussion."
              : "What can I help you with today?"}
          </p>
          {activeStudyGroup && (
            <div className="group-online-strip">
              {groupOnlineUsers.length === 0 && <span className="online-chip">No one online</span>}
              {groupOnlineUsers.map((member) => (
                <span key={member.userId} className="online-chip">
                  {String(member.name || "U")
                    .slice(0, 2)
                    .toUpperCase()}{" "}
                  {member.name}
                </span>
              ))}
            </div>
          )}
        </header>

        <div className="ai-chat-body" ref={chatBodyRef}>
          {initializing && <p className="ai-hint">Loading chats...</p>}

          {!initializing && messages.length === 0 && (
            <p className="ai-hint">
              {activeStudyGroup
                ? "Start the group discussion. AI will respond to everyone in this shared room."
                : "Hi, how can I help you today? You can also attach a file or screenshot."}
            </p>
          )}

          {messages.map((msg, index) => (
            <div
              key={index}
              className={`msg-row ${
                activeStudyGroup
                  ? msg.sender === "user" && msg.isSelf
                    ? "me"
                    : "bot"
                  : msg.sender === "user"
                    ? "me"
                    : "bot"
              }`}
            >
              <div className="msg-bubble">
                {activeStudyGroup && msg.sender === "user" && (
                  <small className="msg-user-label">{msg.userName || "User"}</small>
                )}
                <p>{msg.text}</p>
                {renderAttachments(msg.attachments)}
              </div>
            </div>
          ))}
          {loading && (
            <div className="msg-row bot">
              <div className="msg-bubble typing-bubble" aria-label="Loading response">
                <div className="typing-dots" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="composer">
          {!activeStudyGroup && selectedFiles.length > 0 && (
            <div className="selected-files">
              {selectedFiles.map((file) => (
                <div className="selected-file" key={file.name}>
                  <span>{file.name}</span>
                  <button type="button" onClick={() => removeFile(file.name)}>
                    x
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            rows={2}
            placeholder={activeStudyGroup ? "Ask in your study group..." : "Ask anything..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
          />
          <div className="composer-actions">
            {!activeStudyGroup && (
              <>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden-file-input"
                  multiple
                  onChange={handleSelectFiles}
                />
                <button type="button" onClick={() => fileInputRef.current?.click()} className="attach-btn">
                  <span className="attach-symbol">Attach</span>
                </button>
              </>
            )}
            <button type="button" onClick={handleSend} className="send-btn" disabled={loading}>
              Send
            </button>
          </div>
        </div>

        {error && <p className="error-line">{error}</p>}
      </section>
    </div>
  );
}

export default Chatbot;

