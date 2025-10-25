const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || 'sonar-reasoning';

// Initialize Gemini for embeddings only
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

const extractEntities = async (text) => {
  const prompt = `Extract all named entities from the text below. Categorize them as 'PERSON', 'ORG', or 'LOCATION'.
Return ONLY a valid JSON array. Each object must have 'text' and 'type' fields.
If no entities found, return: []

Do NOT include any text before or after the JSON array.
Do NOT use markdown code blocks.
Do NOT explain your answer.
Do NOT include thinking process.

Text: "${text}"`;

  let result;
  try {
    const messages = [{ role: 'user', content: prompt }];
    result = await chatWithPerplexity(messages);
    
    // The chatWithPerplexity already removes <think> tags, but message might still have issues
    let responseText = result.message || '[]';
    
    console.log('DEBUG extractEntities - Raw response:', responseText.substring(0, 100));
    
    // Remove any remaining <think> tags (shouldn't be needed but just in case)
    responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    
    // Remove markdown code fences if present
    responseText = responseText.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Try to find JSON array in the response
    const arrayMatch = responseText.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      responseText = arrayMatch[0];
    } else {
      // No array found, return empty array
      console.warn('No JSON array found in response, returning empty array');
      return [];
    }
    
    // Parse and validate
    const parsed = JSON.parse(responseText);
    return Array.isArray(parsed) ? parsed : [];

  } catch (error) {
    console.error('ERROR in extractEntities:', error.message);
    if (result?.message) {
      console.error('Problematic response was:', result.message.substring(0, 200));
    }
    return []; // Return a stable empty state on failure
  }
};

const generateEmbedding = async (text) => {
  if (!text || text.trim().length < 1) {
    throw new Error("Input text is too short or invalid to generate an embedding.");
  }

  try {
    console.log('🔄 Generating embedding with Gemini text-embedding-004...');
    const result = await embeddingModel.embedContent(text.trim());
    const embedding = result.embedding;
    
    if (!embedding || !embedding.values || !Array.isArray(embedding.values)) {
      throw new Error('Invalid embedding response from Gemini');
    }
    
    console.log(`✅ Generated embedding with ${embedding.values.length} dimensions`);
    return embedding.values;
  } catch (error) {
    console.error('ERROR in generateEmbedding:', error.message);
    if (error.response) {
      console.error('Gemini API Error Response Data (Embedding):', error.response.data);
      console.error('Gemini API Error Response Status (Embedding):', error.response.status);
    }
    throw new Error(`Failed to generate embedding from Gemini: ${error.message || 'Unknown embedding error'}`);
  }
};

const generateAnswer = async (question, context) => {
  const prompt = `Based strictly on the following context, answer the user's question. If the answer cannot be found in the context, state only that the information is not available in the document.

Context:
${context && context.length > 12000 ? context.slice(0, 12000) + '\n\n[Context truncated]' : context}

Question: ${question}`;

  try {
    const messages = [{ role: 'user', content: prompt }];
    const result = await chatWithPerplexity(messages);
    return (result.message || "Sorry, I couldn't generate a response.").trim();
  } catch (error) {
    console.error('ERROR in generateAnswer:', error.message);
    throw new Error(`Failed to generate answer from AI: ${error.message || 'Unknown AI error'}`);
  }
};

const chatWithPerplexity = async (messages, conversationContext = null) => {
  if (!PERPLEXITY_API_KEY) {
    throw new Error('PERPLEXITY_API_KEY not configured. Please add it to your .env file.');
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('Invalid messages format. Messages must be a non-empty array.');
  }

  // System prompt for the AI assistant
  const systemPrompt = conversationContext || `You are a helpful AI assistant for DeepSearch, a document analysis and search platform.

Your role is to:
- Help users understand their documents
- Answer questions based on document content
- Provide clear and concise explanations
- Assist with document analysis and insights
- Guide users in navigating and searching documents

Keep responses clear, accurate, and helpful. Use examples when appropriate.`;

  try {
    // Filter and prepare messages
    const filteredMessages = messages.filter(msg => {
      // Skip empty messages
      if (!msg.content || !msg.content.trim()) {
        return false;
      }
      return true;
    });

    if (filteredMessages.length === 0) {
      throw new Error('No valid messages to process');
    }

    // Prepare messages - add system context to first user message
    const perplexityMessages = filteredMessages.map((msg, index) => {
      if (index === 0 && msg.role === 'user') {
        return {
          role: 'user',
          content: `[System Context: ${systemPrompt}]\n\n${msg.content}`,
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });

    // Call Perplexity API
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: perplexityMessages,
        max_tokens: 1024,
        temperature: 0.7,
        top_p: 0.9,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Perplexity API error:', errorData);
      throw new Error(`Perplexity API Error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const fullResponse = data.choices?.[0]?.message?.content || 'No response generated';
    
    console.log('DEBUG chatWithPerplexity - Full response:', fullResponse.substring(0, 150));
    
    // Extract thinking content from <think> tags
    const thinkMatch = fullResponse.match(/<think>([\s\S]*?)<\/think>/);
    const reasoning = thinkMatch ? thinkMatch[1].trim() : (data.choices?.[0]?.message?.reasoning || null);

    // Remove ALL <think> tags from the actual message (use global flag)
    let messageText = fullResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    
    // Extra cleanup: remove any text that's not JSON (before first [ or {)
    // Find the first [ or { and start from there
    const jsonStart = Math.max(
      messageText.indexOf('[') !== -1 ? messageText.indexOf('[') : Infinity,
      messageText.indexOf('{') !== -1 ? messageText.indexOf('{') : Infinity
    );
    
    if (jsonStart !== Infinity && jsonStart < messageText.length) {
      messageText = messageText.substring(jsonStart).trim();
    }

    console.log('DEBUG chatWithPerplexity - Cleaned message:', messageText.substring(0, 150));

    return {
      message: messageText || 'Sorry, I couldn\'t generate a response.',
      reasoning: reasoning,
      success: true,
    };
  } catch (error) {
    console.error('ERROR in chatWithPerplexity:', error.message);
    throw error;
  }
};

module.exports = {
  extractEntities,
  generateEmbedding,
  generateAnswer,
  chatWithPerplexity,
};