const axios = require("axios");
const { extractFirstJsonObject } = require("../utils/json");

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);

const client = axios.create({
  baseURL: OLLAMA_BASE_URL,
  timeout: OLLAMA_TIMEOUT_MS
});

const chatJSON = async ({ model, systemPrompt, userPrompt, temperature = 0 }) => {
  const response = await client.post("/api/chat", {
    model,
    stream: false,
    format: "json",
    options: { temperature },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });

  const raw = response?.data?.message?.content;
  if (!raw) {
    throw new Error("Ollama chat returned empty content");
  }

  return extractFirstJsonObject(raw);
};

const generateJSONWithImage = async ({ model, prompt, imageBase64, temperature = 0 }) => {
  const response = await client.post("/api/generate", {
    model,
    prompt,
    format: "json",
    stream: false,
    options: { temperature },
    images: [imageBase64]
  });

  const raw = response?.data?.response;
  if (!raw) {
    throw new Error("Ollama vision returned empty response");
  }

  return extractFirstJsonObject(raw);
};

module.exports = {
  chatJSON,
  generateJSONWithImage
};
