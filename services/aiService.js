const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
const generativeModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Ensure this model name is correct for your usage

const extractEntities = async (text) => {
  const prompt = `Extract named entities (PERSON, ORG, LOCATION) from the following text. Provide the output as a JSON array where each object has 'text' and 'type'. If no entities are found, return an empty JSON array.
  IMPORTANT: Only return the JSON array. Do NOT include any additional text, explanations, or Markdown code block fences (like \`\`\`json\`\`\`). The output must be valid, plain JSON.

  Text: "${text}"

  JSON Entities:`;

  try {
    console.log("DEBUG (Entities): Sending prompt to Gemini. Prompt length:", prompt.length);
    const result = await generativeModel.generateContent(prompt);
    const response = await result.response;
    let jsonString = response.text();

    console.log("DEBUG (Entities): Raw Gemini response:", jsonString);

    const markdownCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const match = jsonString.match(markdownCodeBlockRegex);

    if (match && match[1]) {
      jsonString = match[1].trim();
      console.log("DEBUG (Entities): Cleaned Gemini response (after removing markdown):", jsonString);
    } else {
      jsonString = jsonString.trim();
      console.log("DEBUG (Entities): Gemini response (no markdown fences found, just trimmed):", jsonString);
    }

    const parsed = JSON.parse(jsonString);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('ERROR (Entities) in extractEntities (aiService.js):', error);
    if (error.response) {
      console.error("Gemini API Error Response Data (Entities):", error.response.data);
      console.error("Gemini API Error Response Status (Entities):", error.response.status);
    }
    // Re-throw the error or return an empty array based on desired behavior
    return []; // Return empty array on error for entity extraction
  }
};

const generateEmbedding = async (text) => {
  try {
    const result = await embeddingModel.embedContent(text);
    const embedding = result.embedding;
    return embedding.values;
  } catch (error) {
    console.error('ERROR (Embedding) in generateEmbedding (aiService.js):', error);
    if (error.response) {
      console.error("Gemini API Error Response Data (Embedding):", error.response.data);
      console.error("Gemini API Error Response Status (Embedding):", error.response.status);
    }
    throw new Error(`Failed to generate embedding from AI: ${error.message || 'Unknown embedding error'}`);
  }
};

const generateAnswer = async (question, context) => {
  const prompt = `Based strictly on the following context, answer the user's question. If the answer cannot be found in the context, state that the information is not available in the document.\n\nContext:\n${context}\n\nQuestion: ${question}`;

  try {
    console.log("DEBUG (Answer): Sending prompt to Gemini. Prompt length:", prompt.length);
    // Log a snippet of the context to check for excessive length
    console.log("DEBUG (Answer): First 500 chars of context:", context.substring(0, 500)); 

    const result = await generativeModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log("DEBUG (Answer): Gemini API call successful.");
    return text;
  } catch (error) {
    console.error("ERROR (Answer) in generateAnswer (aiService.js):", error); // THIS IS THE CRITICAL NEW LOG
    if (error.response) {
      console.error("Gemini API Error Response Data (Answer):", error.response.data);
      console.error("Gemini API Error Response Status (Answer):", error.response.status);
    }
    throw new Error(`Failed to generate answer from AI: ${error.message || 'Unknown AI error'}`);
  }
};

module.exports = {
  extractEntities,
  generateEmbedding,
  generateAnswer,
};
