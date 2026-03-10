const express = require("express");
const axios = require("axios");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { message } = req.body;

    console.log("User message:", message);

    const response = await axios.post(
      "http://127.0.0.1:11434/api/generate",
      {
        model: "llama3",
        prompt: `
You are a helpful academic assistant.
Answer the question clearly and directly.
Do not explain the API or technical request.
Question: ${message}
Answer:
        `,
        stream: false,
      }
    );

    res.json({
      reply: response.data.response,
    });

  } catch (error) {
    console.error("Ollama error:", error.message);
    res.status(500).json({ reply: "Local AI server error." });
  }
});

module.exports = router;