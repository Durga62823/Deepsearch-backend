const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Initialize the Google Generative AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Models for different tasks
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
const generativeModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Extracts named entities from text using Gemini.
 * (This is your function, now living in the service file)
 * @param {string} text - The text to process.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of entities.
 */
const extractEntities = async (text) => {
  // Enhanced prompt to explicitly ask for *only* JSON and no markdown fences
  const prompt = `Extract named entities (PERSON, ORG, LOCATION) from the following text. Provide the output as a JSON array where each object has 'text' and 'type'. If no entities are found, return an empty JSON array.
  IMPORTANT: Only return the JSON array. Do NOT include any additional text, explanations, or Markdown code block fences (like \`\`\`json\`\`\`). The output must be valid, plain JSON.

  Text: "${text}"

  JSON Entities:`;

  try {
    const result = await generativeModel.generateContent(prompt);
    const response = await result.response;
    let jsonString = response.text(); // Get the text content of the response

    console.log("Raw Gemini response for entities:", jsonString); // For debugging: log the raw response

    // --- FIX FOR MARKDOWN FENCES ---
    // Clean the response: remove Markdown code block fences if they exist
    // This is robust because sometimes Gemini might put 'json' after the backticks
    // and sometimes it might just use plain backticks.
    const markdownCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const match = jsonString.match(markdownCodeBlockRegex);

    if (match && match[1]) {
      jsonString = match[1].trim(); // Use the captured group as the cleaned string
      console.log("Cleaned Gemini response (after removing markdown):", jsonString);
    } else {
      // If no markdown fences are found, just trim any leading/trailing whitespace
      jsonString = jsonString.trim();
      console.log("Gemini response (no markdown fences found, just trimmed):", jsonString);
    }
    // --- END FIX ---

    // Now try to parse the cleaned string
    const parsed = JSON.parse(jsonString);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Error calling Gemini API for entities:', error);
    // You might want to log the `jsonString` here if parsing fails, to see what it looked like
    // console.error('Failed to parse string:', jsonString);
    return []; // Return empty array on error
  }
};

/**
 * Creates a vector embedding for a piece of text.
 * @param {string} text - The input text to embed.
 * @returns {Promise<number[]>} A promise that resolves to the embedding vector.
 */
const generateEmbedding = async (text) => {
  const result = await embeddingModel.embedContent(text);
  const embedding = result.embedding;
  return embedding.values;
};

/**
 * Generates an answer to a question using provided context.
 * @param {string} question - The user's question.
 * @param {string} context - The relevant text chunks.
 * @returns {Promise<string>} A promise that resolves to the AI-generated answer.
 */
const generateAnswer = async (question, context) => {
  const prompt = `Based strictly on the following context, answer the user's question. If the answer cannot be found in the context, state that the information is not available in the document.\n\nContext:\n${context}\n\nQuestion: ${question}`;

  const result = await generativeModel.generateContent(prompt);
  const response = await result.response;
  return response.text();
};

module.exports = {
  extractEntities,
  generateEmbedding,
  generateAnswer,
};