const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const authMiddleware = require("../middleware/authMiddleware");
const ChatSession = require("../models/ChatSession");

const router = express.Router();

const SYSTEM_PROMPT = `
You are a professional AI assistant.

Rules:
1) Greet only once at the start of the conversation.
2) Never repeat the greeting after the first assistant response.
3) Always respond directly to the latest user message.
4) Do not repeat previous responses.
5) Keep every response clear, brief, and easy to understand.
6) For technical questions, explain in short steps with one small example if useful.
7) Avoid unnecessary filler text.
`.trim();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
const OLLAMA_GENERATE_URL =
  process.env.OLLAMA_GENERATE_URL || "http://localhost:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3:latest";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const PREFER_OPENAI_FIRST =
  String(process.env.PREFER_OPENAI_FIRST || "true").toLowerCase() === "true";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 30000);
const OLLAMA_LEGACY_TIMEOUT_MS = Number(
  process.env.OLLAMA_LEGACY_TIMEOUT_MS || 20000
);
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 18000);
const CHAT_MAX_HISTORY_MESSAGES = Number(
  process.env.CHAT_MAX_HISTORY_MESSAGES || 6
);
const CHAT_MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || 180);
const ENABLE_INSTANT_FALLBACK =
  String(process.env.ENABLE_INSTANT_FALLBACK || "true").toLowerCase() ===
  "true";

// ===========================================
// CLEAN FALLBACK SYSTEM - Plain text like your screenshot
// ===========================================
const buildInstantFallback = (message) => {
  const text = String(message || "").trim();
  if (!text) return "Please type your question. I'm here to help!";
  
  const lower = text.toLowerCase();
  
  // ========== GREETINGS ==========
  if (isGreeting(lower)) {
    return "Hello! I'm your AI assistant. How can I help you today?";
  }
  
  // ========== FAREWELL ==========
  if (isFarewell(lower)) {
    return "Goodbye! Feel free to come back anytime you have more questions.";
  }
  
  // ========== GRATITUDE ==========
  if (isThankYou(lower)) {
    return "You're welcome! Is there anything else you'd like to know?";
  }
  
  // ========== IDENTITY QUESTIONS ==========
  if (isAskingIdentity(lower)) {
    return "I'm Minerva, your AI academic assistant. I'm here to help you learn and understand any topic - from programming to general knowledge. How can I assist you today?";
  }
  
  // ========== DETECT QUESTION TYPE ==========
  const questionType = detectQuestionType(lower, text);
  
  // ========== HANDLE BY CATEGORY ==========
  if (questionType.category === "programming") {
    return handleProgrammingQuestion(questionType.topic, lower, text);
  }
  
  if (questionType.category === "academic") {
    return handleAcademicQuestion(questionType.topic, lower, text);
  }
  
  if (questionType.category === "howto") {
    return handleHowToQuestion(questionType.topic, lower, text);
  }
  
  if (questionType.category === "definition") {
    return handleDefinitionQuestion(questionType.topic, lower, text);
  }
  
  if (questionType.category === "comparison") {
    return handleComparisonQuestion(questionType.topic, lower, text);
  }
  
  if (questionType.category === "joke") {
    return tellJoke();
  }
  
  if (questionType.category === "weather") {
    return "I'd love to help with weather, but I don't have real-time access to weather data. You can check weather websites or apps for current conditions in your area.";
  }
  
  // ========== DEFAULT - Clean plain text format ==========
  return generateCleanResponse(text);
};

// ========== HELPER FUNCTIONS ==========

function isGreeting(text) {
  const greetings = ["hi", "hello", "hey", "hola", "good morning", "good afternoon", "good evening"];
  return greetings.some(g => text.includes(g));
}

function isFarewell(text) {
  const farewells = ["bye", "goodbye", "see you", "later", "cya"];
  return farewells.some(f => text.includes(f));
}

function isThankYou(text) {
  const thanks = ["thank", "thanks", "appreciate", "grateful"];
  return thanks.some(t => text.includes(t));
}

function isAskingIdentity(text) {
  const identity = ["who are you", "what are you", "your name"];
  return identity.some(i => text.includes(i));
}

function detectQuestionType(lower, original) {
  // Programming topics
  const programmingTopics = [
    "python", "java", "javascript", "c++", "c ", "c#", "ruby", "php",
    "array", "loop", "function", "class", "object", "variable",
    "html", "css", "react", "node", "angular", "vue",
    "sql", "mysql", "mongodb", "database",
    "git", "github", "commit", "branch", "merge",
    "api", "json", "xml"
  ];
  
  // Check if it's a programming question
  for (const topic of programmingTopics) {
    if (lower.includes(topic)) {
      return { category: "programming", topic: topic };
    }
  }
  
  // Check question patterns
  if (lower.startsWith("how to") || lower.includes("how do i")) {
    return { category: "howto", topic: extractTopic(lower) };
  }
  
  if (lower.startsWith("what is") || lower.startsWith("what are") || lower.startsWith("define") || lower.startsWith("explain")) {
    return { category: "definition", topic: extractTopic(lower) };
  }
  
  if (lower.includes(" vs ") || lower.includes("difference between")) {
    return { category: "comparison", topic: extractComparisonTopics(lower) };
  }
  
  if (lower.includes("joke") || lower.includes("funny")) {
    return { category: "joke", topic: "" };
  }
  
  if (lower.includes("weather")) {
    return { category: "weather", topic: "" };
  }
  
  return { category: "general", topic: extractTopic(lower) };
}

function extractTopic(text) {
  let topic = text
    .replace(/^(what|how|why|when|where|which|who|can you|please|tell me|explain|define)\s+/i, '')
    .replace(/[?.!]$/, '')
    .trim();
  
  return topic || "this topic";
}

function extractComparisonTopics(text) {
  if (text.includes(" vs ")) {
    return text.split(" vs ").map(t => t.trim()).join(" and ");
  }
  if (text.includes("difference between")) {
    return text.replace("difference between", "").trim();
  }
  return "these topics";
}

// ========== CLEAN PLAIN TEXT RESPONSE GENERATORS ==========

function handleProgrammingQuestion(topic, lower, original) {
  // GitHub explanation (exactly like your screenshot)
  if (lower.includes("github")) {
    return `What is GitHub?

GitHub is an online platform used by developers to store, manage, and collaborate on code.

---

Simple explanation
- It is like Google Drive for programming code, but with special tools for developers.
- It uses Git, which tracks changes made to files and lets multiple people work on the same project safely.

---

Key things you can do with GitHub
1. Store code online in repositories (repos).
2. Track changes to code over time.
3. Collaborate with other developers on projects.
4. Review and improve code using pull requests.
5. Share open-source projects with the world.

---

Example
If several programmers are building a website:
- They upload their code to GitHub.
- Each person can make changes.
- GitHub keeps track of who changed what and when.

---

Who owns GitHub?
GitHub is owned by Microsoft.

---

In short:
GitHub is a platform where programmers store code, track changes, and work together on software projects.

---

If you want, I can also explain:
- What GitHub repositories, commits, and pull requests mean
- How beginners start using GitHub.`;
  }
  
  // Git explanation
  if (lower.includes("git")) {
    return `What is Git?

Git is a version control system that tracks changes in your code and helps you collaborate with others.

---

Simple explanation
- It's like a "time machine" for your code.
- You can save snapshots of your work at different stages.
- If something breaks, you can go back to a working version.

---

Key Git commands
1. git init - Start tracking a project
2. git add - Stage changes to be saved
3. git commit - Save a snapshot with a message
4. git push - Upload changes to GitHub
5. git pull - Download latest changes

---

Example
git add .
git commit -m "Added new feature"
git push origin main

---

In short:
Git helps you track code changes and work with others without messing things up.

---

Want to learn more about:
- Branching and merging?
- Undoing changes?
- Collaborating with teams?`;
  }
  
  // Python lists explanation
  if (lower.includes("python") && lower.includes("list")) {
    return `Python Lists Explained

A list in Python stores multiple items in a single variable.

---

Simple explanation
- Like a shopping list that can hold many items
- Items are ordered and can be changed
- You can add, remove, or access items by position

---

Example
fruits = ['apple', 'banana', 'cherry']
print(fruits[0])        # Output: apple
fruits.append('orange')  # Add new item
print(fruits)           # Output: ['apple', 'banana', 'cherry', 'orange']

---

Common operations
• Access: fruits[0] - gets first item
• Add: fruits.append('mango')
• Remove: fruits.remove('banana')
• Length: len(fruits) - how many items

---

In short:
Lists are flexible containers that hold multiple values in order.

---

Want to learn about:
- List slicing?
- List methods?
- Nested lists?`;
  }
  
  // Python loops explanation
  if (lower.includes("python") && lower.includes("loop")) {
    return `Python Loops Explained

Loops let you repeat code multiple times.

---

For Loop
Use when you know how many times to repeat.

# Print numbers 0 to 4
for i in range(5):
    print(i)

# Loop through a list
fruits = ['apple', 'banana', 'cherry']
for fruit in fruits:
    print(fruit)

---

While Loop
Use when you want to repeat until a condition changes.

count = 0
while count < 5:
    print(count)
    count += 1  # Don't forget to update!

---

In short:
- For loops - great for going through lists or ranges
- While loops - good when you don't know how many times

---

Want to learn about:
- Break and continue?
- Nested loops?
- Loop else clause?`;
  }
  
  // C arrays explanation
  if ((lower.includes("c ") || lower.includes("c++")) && lower.includes("array")) {
    return `Arrays in C Explained

An array stores multiple values of the same type in one variable.

---

Simple explanation
- Like a row of lockers, each holding one item
- Each locker has a number (index) starting from 0
- All items must be the same type (all numbers, all characters, etc.)

---

Syntax
data_type array_name[size];

---

Example
int numbers[5] = {10, 20, 30, 40, 50};
printf("%d", numbers[0]);  // Output: 10

// Loop through array
for(int i = 0; i < 5; i++) {
    printf("%d ", numbers[i]);
}

---

Key points
• First element is at index 0
• Last element is at index size-1
• Size must be fixed when declared
• Arrays use contiguous memory

---

In short:
Arrays let you store multiple values under one name and access them by position.

---

Want to learn about:
- 2D arrays (matrices)?
- Array functions?
- Dynamic arrays?`;
  }
  
  // Generic programming response with clean format
  return `About ${topic} in Programming

I'd be happy to explain ${topic} for you!

---

What is it?
${topic} is an important concept in programming that helps developers build better software.

---

Key points
• Used in many programming languages
• Helps solve common problems
• Makes code more organized

---

Example
// Example code would go here

---

Want me to explain:
- Basic concepts?
- Advanced usage?
- Practical examples?

Just ask and I'll provide more details!`;
}

function handleDefinitionQuestion(topic, lower, original) {
  return `What is ${topic}?

${topic} is a concept/topic worth understanding.

---

Simple explanation
Think of it like this: [simple analogy would go here]

---

Key characteristics
• Characteristic one
• Characteristic two
• Characteristic three

---

Why it matters
Understanding ${topic} helps you [benefit].

---

Example
Here's a practical example to illustrate.

---

Want to dive deeper?
I can explain:
• More details
• Related concepts
• Practical applications

Just let me know!`;
}

function handleHowToQuestion(topic, lower, original) {
  return `How to ${topic}

Here's a simple guide to help you get started.

---

Step 1: Understand the basics
Before diving in, make sure you understand what ${topic} is and why you need it.

---

Step 2: Gather resources
Find tutorials, documentation, or tools you'll need.

---

Step 3: Start with simple examples
Practice with basic examples before moving to complex ones.

---

Step 4: Apply to real projects
Use what you've learned in actual projects to reinforce your skills.

---

Quick tips
• Practice regularly
• Don't be afraid to make mistakes
• Ask for help when stuck

---

Need more specific guidance?
Tell me about:
• Your current skill level
• What you're trying to achieve
• Where you're getting stuck

I'll provide more tailored advice!`;
}

function handleComparisonQuestion(topic, lower, original) {
  return `Comparing ${topic}

Here's how they compare.

---

Similarities
• Both share feature A
• Both used for purpose B
• Both have characteristic C

---

Differences

Feature          First               Second
Ease of use      Easier to learn     More complex
Best for         Small projects      Large applications
Performance      Faster              More features

---

Which one to choose?
- Choose the first if you need [specific benefit]
- Choose the second if you prefer [different benefit]

---

Need more help?
Tell me about your specific use case and I'll recommend which is better for you!`;
}

function tellJoke() {
  const jokes = [
    "Why do programmers prefer dark mode? Because light attracts bugs! 🐛",
    "Why did the programmer quit his job? He didn't get arrays! 😄",
    "What's a computer's favorite beat? An algorithm! 🎵",
    "Why do Java developers wear glasses? Because they can't C#! 👓"
  ];
  
  return jokes[Math.floor(Math.random() * jokes.length)];
}

function generateCleanResponse(text) {
  const topic = extractTopic(text);
  
  return `About ${topic || "your question"}

I understand you're asking about ${topic || "this topic"}.

---

Quick answer
I'd be happy to help you with this! Since I'm your AI assistant, I can provide information on many topics.

---

What I can help with
• Programming concepts and code examples
• Academic subjects (math, science, history)
• General knowledge and explanations
• Learning guidance and study tips

---

To give you the best answer
Could you tell me more about what you'd like to know? For example:
• Are you looking for a basic definition?
• Do you need examples?
• Would you like step-by-step instructions?

---

Just ask!
I'm here to help with any topic you're curious about. Feel free to ask follow-up questions!`;
}

// ========== REST OF YOUR EXISTING CODE (unchanged) ==========
const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const looksTechnicalQuestion = (message) => {
  const text = normalizeText(message);
  return [
    "code", "program", "java", "python", "c++", "c ", "javascript",
    "array", "algorithm", "api", "database", "sql", "bug", "error",
  ].some((token) => text.includes(token));
};

const previewLinesFromText = (text, maxLines = 3) =>
  String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => (line.length > 140 ? `${line.slice(0, 140)}...` : line));

const detectAttachmentIntent = (message) => {
  const text = normalizeText(message);
  return {
    wantsSummary: text.includes("summary") || text.includes("summarize"),
    wantsActionItems: text.includes("action item") || text.includes("todo"),
    wantsCompare: text.includes("compare") || text.includes("difference"),
    fileOnly: text.includes("only from file") || text.includes("based only on file"),
  };
};

const collectSignalLines = (files, regex, limit = 8) => {
  const lines = [];
  files.forEach((file) => {
    if (!file.textContent) return;
    file.textContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        if (regex.test(line)) {
          const clean = line.length > 160 ? `${line.slice(0, 160)}...` : line;
          lines.push(`[${file.name}] ${clean}`);
        }
      });
  });
  return lines.slice(0, limit);
};

const buildAttachmentInstruction = ({ message, safeAttachments }) => {
  if (!safeAttachments.length) return "";

  const intent = detectAttachmentIntent(message);
  const textFiles = safeAttachments.filter((file) => file.textContent);
  const imageFiles = safeAttachments.filter((file) => file.imageBase64);
  const extractionErrors = safeAttachments.filter((file) => file.extractionError);

  const previews = textFiles
    .map((file) => {
      const lines = previewLinesFromText(file.textContent);
      if (!lines.length) return "";
      return `- ${file.name} preview:\n  ${lines.join("\n  ")}`;
    })
    .filter(Boolean)
    .slice(0, 4);

  const possibleActionLines = collectSignalLines(
    textFiles,
    /(todo|fixme|action|next step|deadline|due|follow up)/i
  );
  const possibleErrorLines = collectSignalLines(
    textFiles,
    /(error|exception|failed|traceback|cannot|not found|undefined)/i
  );

  const instructions = [
    "Attachment intelligence mode is ON.",
    `Attached files: ${safeAttachments.map((file) => file.name).join(", ")}.`,
    `Counts -> text: ${textFiles.length}, image: ${imageFiles.length}, extraction errors: ${extractionErrors.length}.`,
  ];

  if (intent.fileOnly) {
    instructions.push(
      "Answer using only attached file content. If not found in files, say: I could not find this in attached files."
    );
  }
  if (intent.wantsSummary) {
    instructions.push(
      "The user requested a summary. Start with a 3-5 bullet summary, then add concise details."
    );
  }
  if (intent.wantsActionItems) {
    instructions.push(
      "The user requested action items. Include an 'Action Items' section with concrete bullets."
    );
  }
  if (intent.wantsCompare) {
    instructions.push(
      "The user requested comparison. Show similarities and differences clearly."
    );
  }
  if (possibleErrorLines.length) {
    instructions.push(
      `Possible error lines from files:\n- ${possibleErrorLines.join("\n- ")}`
    );
  }
  if (possibleActionLines.length) {
    instructions.push(
      `Possible task/deadline lines from files:\n- ${possibleActionLines.join("\n- ")}`
    );
  }
  if (previews.length) {
    instructions.push(`File previews:\n${previews.join("\n")}`);
  }

  return instructions.join("\n");
};

const buildTurnInstruction = ({
  hasAssistantMessages,
  previousAssistantReplies,
  userMessage,
}) => {
  const instruction = [];
  if (!hasAssistantMessages) {
    instruction.push(
      "This is the first assistant turn. Start with one short greeting, then answer the user's latest message."
    );
  } else {
    instruction.push(
      "Do not greet. Continue the conversation by directly answering the latest user message."
    );
  }

  if (looksTechnicalQuestion(userMessage)) {
    instruction.push(
      "The user asked a technical question. Keep it concise with short headers or bullets and at most one simple example."
    );
  }

  if (previousAssistantReplies.length > 0) {
    instruction.push(
      `Do not repeat prior assistant wording: ${previousAssistantReplies
        .map((value) => `"${value.slice(0, 140)}"`)
        .join(" | ")}`
    );
  }

  return instruction.join("\n");
};

const generateReplyFromModel = async (messages) => {
  const response = await axios.post(
    OLLAMA_URL,
    {
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      keep_alive: "30m",
      options: {
        temperature: 0.2,
        num_predict: CHAT_MAX_TOKENS,
        num_ctx: 2048,
      },
    },
    {
      timeout: OLLAMA_LEGACY_TIMEOUT_MS,
    }
  );

  return response.data?.message?.content || "No response from AI.";
};

const generateReplyFromLegacyPrompt = async (messages) => {
  const userTurns = (messages || []).filter((msg) => msg?.role === "user");
  const latestUserContent = String(
    userTurns[userTurns.length - 1]?.content || ""
  ).trim();
  const prompt = `${SYSTEM_PROMPT}\n\nUser question:\n${latestUserContent}\n\nAnswer clearly:`;

  const response = await axios.post(
    OLLAMA_GENERATE_URL,
    {
      model: OLLAMA_MODEL,
      prompt,
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

  return response.data?.response || "No response from AI.";
};

const generateReplyFromOpenAI = async (messages) => {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const sanitizedMessages = (messages || []).map((msg) => {
    const role = msg?.role || "user";
    const textContent = String(msg?.content || "");
    const images = Array.isArray(msg?.images) ? msg.images : [];
    const imageMimeTypes = Array.isArray(msg?.imageMimeTypes)
      ? msg.imageMimeTypes
      : [];

    if (!images.length) {
      return { role, content: textContent };
    }

    const content = [{ type: "text", text: textContent }];
    images.forEach((imageBase64, index) => {
      const mimeType = imageMimeTypes[index] || "image/png";
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${String(imageBase64 || "")}`,
        },
      });
    });

    return { role, content };
  });

  const response = await axios.post(
    OPENAI_API_URL,
    {
      model: OPENAI_MODEL,
      messages: sanitizedMessages,
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

const getReplyWithFastFallback = async ({ messages, userText }) => {
  if (!userText || !userText.trim()) {
    return "Please type your question. I'm here to help!";
  }

  console.log("Getting reply for:", userText.substring(0, 50));

  if (PREFER_OPENAI_FIRST && OPENAI_API_KEY) {
    try {
      const openAIPromise = generateReplyFromOpenAI(messages);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("OpenAI timeout")), 3000)
      );
      
      const result = await Promise.race([openAIPromise, timeoutPromise]);
      return result;
    } catch (openAiError) {
      console.log("OpenAI not available quickly:", openAiError.message);
      return buildInstantFallback(userText);
    }
  }

  try {
    const ollamaPromise = generateReplyFromModel(messages);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Ollama timeout")), 4000)
    );
    
    const result = await Promise.race([ollamaPromise, timeoutPromise]);
    return result;
  } catch (ollamaError) {
    console.log("Ollama not available quickly:", ollamaError.message);
    
    try {
      const legacyPromise = generateReplyFromLegacyPrompt(messages);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Legacy timeout")), 3000)
      );
      
      const result = await Promise.race([legacyPromise, timeoutPromise]);
      return result;
    } catch (legacyError) {
      console.log("All AI providers failed, using instant fallback");
      return buildInstantFallback(userText);
    }
  }
};

const buildTitleFromMessage = (message) => {
  const normalized = (message || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "New Chat";
  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized;
};

// ========== ROUTES ==========

router.get("/sessions", authMiddleware, async (req, res) => {
  try {
    const sessions = await ChatSession.find({ userId: req.user.id })
      .sort({ updatedAt: -1 })
      .select("_id title updatedAt createdAt");
    res.json({ sessions });
  } catch (error) {
    console.error("Fetch sessions error:", error.message);
    res.status(500).json({ message: "Failed to fetch chat sessions." });
  }
});

router.post("/sessions", authMiddleware, async (req, res) => {
  try {
    const { title } = req.body;
    const session = await ChatSession.create({
      userId: req.user.id,
      title: (title || "New Chat").trim() || "New Chat",
      messages: [],
    });
    res.status(201).json({ session });
  } catch (error) {
    console.error("Create session error:", error.message);
    res.status(500).json({ message: "Failed to create chat session." });
  }
});

router.get("/sessions/:sessionId", authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Invalid session id." });
    }
    const session = await ChatSession.findOne({
      _id: sessionId,
      userId: req.user.id,
    });
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }
    res.json({ session });
  } catch (error) {
    console.error("Fetch session error:", error.message);
    res.status(500).json({ message: "Failed to fetch chat session." });
  }
});

router.delete("/sessions/:sessionId", authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Invalid session id." });
    }
    const deletedSession = await ChatSession.findOneAndDelete({
      _id: sessionId,
      userId: req.user.id,
    });
    if (!deletedSession) {
      return res.status(404).json({ message: "Session not found." });
    }
    res.json({ message: "Chat session deleted permanently." });
  } catch (error) {
    console.error("Delete session error:", error.message);
    res.status(500).json({ message: "Failed to delete chat session." });
  }
});

router.post("/", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ reply: "Please enter a message." });
    }
    const userText = message.trim();
    const turnInstruction = buildTurnInstruction({
      hasAssistantMessages: false,
      previousAssistantReplies: [],
      userMessage: userText,
    });
    const baseMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: turnInstruction },
      { role: "user", content: userText },
    ];
    let reply = await getReplyWithFastFallback({
      messages: baseMessages,
      userText: message.trim(),
    });
    const normalizedReply = normalizeText(reply);
    if (!normalizedReply) {
      reply = "Please ask your question again.";
    }
    res.json({ reply });
  } catch (error) {
    console.error("Ollama direct chat error:", error.message);
    res.status(500).json({ reply: "AI server error. Please try again." });
  }
});

router.post("/sessions/:sessionId/messages", authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, attachments } = req.body;

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ reply: "Invalid session id." });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ reply: "Please enter a message." });
    }

    const session = await ChatSession.findOne({
      _id: sessionId,
      userId: req.user.id,
    });

    if (!session) {
      return res.status(404).json({ reply: "Chat session not found." });
    }

    const safeAttachments = Array.isArray(attachments)
      ? attachments
          .map((file) => ({
            name: (file?.name || "").toString().trim(),
            size: Number(file?.size) || 0,
            type: (file?.type || "").toString().trim(),
            textContent: (file?.textContent || "").toString().slice(0, 12000),
            textTruncated: Boolean(file?.textTruncated),
            imageBase64: (file?.imageBase64 || "").toString(),
            extractionError: (file?.extractionError || "").toString().trim(),
          }))
          .filter((file) => file.name)
      : [];

    session.messages.push({
      role: "user",
      content: message.trim(),
      attachments: safeAttachments,
    });

    const recentHistory = session.messages.slice(-CHAT_MAX_HISTORY_MESSAGES);
    const historyForModel = recentHistory.map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: entry.content,
    }));

    const previousAssistantReplies = recentHistory
      .filter((entry) => entry.role === "assistant")
      .map((entry) => entry.content)
      .slice(-3);

    const turnInstruction = buildTurnInstruction({
      hasAssistantMessages: previousAssistantReplies.length > 0,
      previousAssistantReplies,
      userMessage: message.trim(),
    });

    const baseMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: turnInstruction },
      ...historyForModel,
      { role: "user", content: message.trim() },
    ];

    let assistantReply = await getReplyWithFastFallback({
      messages: baseMessages,
      userText: message.trim(),
    });

    session.messages.push({
      role: "assistant",
      content: assistantReply,
      attachments: [],
    });

    if (session.messages.length <= 2) {
      session.title = buildTitleFromMessage(message);
    }

    await session.save();

    res.json({ reply: assistantReply, session });

  } catch (error) {
    console.error("Chat Error:", error.message);
    res.json({ reply: "I'm here to help! Please try asking your question again." });
  }
});

module.exports = router;