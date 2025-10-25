require('dotenv').config();

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || 'sonar-reasoning';

const extractEntities = async (text) => {
  const prompt = `From the following text, extract all named entities. Categorize them as 'PERSON', 'ORG', or 'LOCATION'.
  Provide the output as a JSON array where each object has 'text' and 'type'.
  If no entities are found, return an empty JSON array: [].
  IMPORTANT: Only return the JSON array. Do NOT include any explanations or markdown fences.
  
  Text: "${text}"`;

  try {
    const messages = [{ role: 'user', content: prompt }];
    const result = await chatWithPerplexity(messages);
    let jsonString = result.message || '[]';

    // Robust cleaning to handle potential markdown fences
    const markdownCodeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const match = jsonString.match(markdownCodeBlockRegex);
    if (match && match[1]) {
      jsonString = match[1].trim();
    }
    
    // Ensure we parse the JSON
    const parsed = JSON.parse(jsonString);
    return Array.isArray(parsed) ? parsed : [];

  } catch (error) {
    console.error('ERROR in extractEntities:', error.message);
    return []; // Return a stable empty state on failure
  }
};

const generateEmbedding = async (text) => {
  if (!text || text.trim().length < 1) {
    throw new Error("Input text is too short or invalid to generate an embedding.");
  }

  try {
    // Note: Perplexity doesn't provide embeddings API
    // You'll need to use a different service for embeddings (OpenAI, Cohere, etc.)
    throw new Error('Embeddings functionality requires a dedicated embedding service. Please configure OpenAI, Cohere, or similar.');
  } catch (error) {
    console.error('ERROR in generateEmbedding:', error.message);
    throw error;
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
    
    // Extract thinking content from <think> tags
    const thinkMatch = fullResponse.match(/<think>([\s\S]*?)<\/think>/);
    const reasoning = thinkMatch ? thinkMatch[1].trim() : (data.choices?.[0]?.message?.reasoning || null);

    // Remove <think> tags from the actual message
    const messageText = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

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