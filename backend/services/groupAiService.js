const axios = require("axios");

const SYSTEM_PROMPT = `
You are a study-group AI tutor.
Rules:
1) Keep answers concise and practical.
2) Refer to users by name when helpful.
3) In group chats, acknowledge who asked the question.
4) Prefer short step-by-step explanations.
5) If users solve practice problems, validate and correct clearly.
`.trim();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3:latest";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const PREFER_OPENAI_FIRST =
  String(process.env.PREFER_OPENAI_FIRST || "true").toLowerCase() === "true";
const CHAT_MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || 220);
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 20000);
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 30000);

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const buildFallbackReply = (userName, userText) => {
  const cleanName = (userName || "Student").trim();
  const text = String(userText || "").trim();
  if (!text) {
    return `${cleanName}, please send your question and I will help step by step.`;
  }
  return `${cleanName}, I could not reach the AI provider right now. Please retry once.`;
};

const buildConversationContext = (messages = []) =>
  messages.slice(-18).map((entry) => ({
    role: entry.role === "assistant" ? "assistant" : "user",
    content:
      entry.role === "assistant"
        ? entry.content
        : `${entry.userName || "Student"}: ${entry.content}`,
  }));

const generateWithOpenAI = async (messages) => {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await axios.post(
    OPENAI_API_URL,
    {
      model: OPENAI_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: CHAT_MAX_TOKENS,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: OPENAI_TIMEOUT_MS,
    }
  );

  return response.data?.choices?.[0]?.message?.content || "No response from AI.";
};

const generateWithOllama = async (messages) => {
  const response = await axios.post(
    OLLAMA_URL,
    {
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: CHAT_MAX_TOKENS,
      },
    },
    {
      timeout: OLLAMA_TIMEOUT_MS,
    }
  );

  return response.data?.message?.content || "No response from AI.";
};

const getGroupAiReply = async ({ topic, participants = [], history = [], userName, userText }) => {
  const participantNames = participants
    .map((member) => member.name)
    .filter(Boolean)
    .slice(0, 20)
    .join(", ");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: `Group topic: ${topic || "General study"}. Participants: ${participantNames || "Unknown"}.`,
    },
    ...buildConversationContext(history),
    {
      role: "user",
      content: `${userName || "Student"} asked: ${String(userText || "").trim()}`,
    },
  ];

  try {
    if (PREFER_OPENAI_FIRST && OPENAI_API_KEY) {
      return await generateWithOpenAI(messages);
    }
    return await generateWithOllama(messages);
  } catch (firstError) {
    try {
      if (PREFER_OPENAI_FIRST && OPENAI_API_KEY) {
        return await generateWithOllama(messages);
      }
      return await generateWithOpenAI(messages);
    } catch (secondError) {
      const _ = secondError;
      return buildFallbackReply(userName, userText);
    }
  }
};

const summarizeByRules = (group, messages = []) => {
  const userMessages = messages.filter((msg) => msg.role === "user");
  const whoAsked = {};

  userMessages.forEach((msg) => {
    const name = msg.userName || "Unknown";
    if (!whoAsked[name]) whoAsked[name] = [];
    whoAsked[name].push(msg.content);
  });

  const topics = Array.from(
    new Set(
      userMessages
        .flatMap((msg) => String(msg.content || "").split(/[.!?]/))
        .map((line) => line.trim())
        .filter((line) => line.length > 12)
        .slice(0, 14)
    )
  ).slice(0, 6);

  const practiceProblems = userMessages
    .map((msg) => msg.content)
    .filter((text) => /(solve|equation|problem|answer|find|calculate)/i.test(text))
    .slice(0, 8);

  const keyTakeaways = [
    topics[0] ? `Main focus: ${topics[0]}` : `Main focus: ${group.topic || "General study discussion"}`,
    userMessages.length
      ? `Team collaboration happened across ${userMessages.length} user questions.`
      : "No user questions were captured in this session.",
    practiceProblems.length
      ? `Practice-oriented discussion included ${practiceProblems.length} problem-solving prompts.`
      : "No explicit practice-problem prompts were detected.",
  ];

  return {
    topicsDiscussed: topics.length ? topics : [group.topic || "General study discussion"],
    whoAskedWhat: Object.entries(whoAsked).map(([name, questions]) => ({
      name,
      questions: questions.slice(0, 4),
    })),
    practiceProblemsSolved: practiceProblems,
    keyTakeaways,
    generatedAt: new Date(),
  };
};

const getGroupSummary = async ({ group, messages }) => {
  const transcript = (messages || [])
    .slice(-40)
    .map((msg) => `${msg.role === "assistant" ? "AI" : msg.userName || "Student"}: ${msg.content}`)
    .join("\n");

  const summaryPrompt = [
    "Create a JSON summary for this study group session.",
    "Return keys only: topicsDiscussed (string[]), whoAskedWhat ({name, questions[]}[]), practiceProblemsSolved (string[]), keyTakeaways (string[]).",
    `Topic: ${group.topic || "General study"}`,
    `Transcript:\n${transcript}`,
  ].join("\n\n");

  const messagesForSummary = [
    { role: "system", content: "You output valid JSON only." },
    { role: "user", content: summaryPrompt },
  ];

  try {
    let raw;
    if (PREFER_OPENAI_FIRST && OPENAI_API_KEY) {
      raw = await generateWithOpenAI(messagesForSummary);
    } else {
      raw = await generateWithOllama(messagesForSummary);
    }

    const parsed = JSON.parse(String(raw || "{}"));
    return {
      topicsDiscussed: Array.isArray(parsed.topicsDiscussed)
        ? parsed.topicsDiscussed.slice(0, 10)
        : [],
      whoAskedWhat: Array.isArray(parsed.whoAskedWhat)
        ? parsed.whoAskedWhat.slice(0, 20)
        : [],
      practiceProblemsSolved: Array.isArray(parsed.practiceProblemsSolved)
        ? parsed.practiceProblemsSolved.slice(0, 20)
        : [],
      keyTakeaways: Array.isArray(parsed.keyTakeaways)
        ? parsed.keyTakeaways.slice(0, 12)
        : [],
      generatedAt: new Date(),
    };
  } catch (error) {
    return summarizeByRules(group, messages);
  }
};

module.exports = {
  normalizeText,
  getGroupAiReply,
  getGroupSummary,
};
