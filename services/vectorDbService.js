const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

// Initialize the Pinecone client
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Get a reference to your Pinecone index
const index = pinecone.index(process.env.PINECONE_INDEX_NAME);

/**
 * Stores text chunks and their embeddings in the vector database.
 * @param {Array<object>} chunks - An array of chunk objects, each with { id, values, metadata }.
 * @returns {Promise<void>}
 */
const storeEmbeddings = async (chunks) => {
  await index.upsert(chunks);
};

/**
 * Finds the most relevant text chunks for a given question embedding,
 * filtered by the user's ID.
 * @param {number[]} questionEmbedding - The vector embedding of the user's question.
 * @param {string} userId - The ID of the user to filter the search by.
 * @param {number} topK - The number of top results to return.
 * @returns {Promise<string[]>} A promise that resolves to an array of the most relevant text chunks.
 */
const queryEmbeddings = async (questionEmbedding, userId, topK = 3) => {
  const queryResponse = await index.query({
    vector: questionEmbedding,
    topK: topK,
    includeMetadata: true,
    // THIS IS THE CRUCIAL UPDATE: Filter results to only this user's documents.
    filter: {
      userId: { '$eq': userId }
    }
  });

  // Extract the original text from the metadata of the search results
  const relevantChunks = queryResponse.matches.map(match => match.metadata.text);
  return relevantChunks;
};

module.exports = {
  storeEmbeddings,
  queryEmbeddings,
};
