const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const indexName = process.env.PINECONE_INDEX_NAME;
if (!indexName) {
  console.error("PINECONE_INDEX_NAME environment variable is not set.");
}
const pineconeIndex = pinecone.Index(indexName);

async function upsertVectors(vectors) {
  try {
    await pineconeIndex.upsert(vectors);
    console.log(`Successfully upserted ${vectors.length} vectors to Pinecone index: ${indexName}.`);
  } catch (error) {
    console.error('Error upserting vectors to Pinecone:', error);
    throw error;
  }
}

async function queryEmbeddings(embedding, userId, topK = 5, documentId = null) {
  try {
    const filter = {
      userId: { '$eq': userId },
    };

    if (documentId) {
      filter.documentId = { '$eq': documentId };
    }

    const queryOptions = {
      vector: embedding,
      topK: topK,
      includeMetadata: true,
      filter: filter,
    };

    console.log('Pinecone query options:', JSON.stringify(queryOptions, null, 2));

    const queryResponse = await pineconeIndex.query(queryOptions);

    const relevantChunks = queryResponse.matches.map(match => match.metadata.text);
    console.log(`Found ${relevantChunks.length} relevant chunks for query.`);
    return relevantChunks;
  } catch (error) {
    console.error('Error querying Pinecone embeddings:', error);
    throw error;
  }
}

async function deleteVectorsByDocumentId(documentId) {
  try {
    await pineconeIndex.delete({ filter: { documentId: { '$eq': documentId } } });
    console.log(`Successfully deleted vectors for document ID: ${documentId} from Pinecone index: ${indexName}.`);
  } catch (error) {
    console.error('Error deleting vectors from Pinecone:', error);
    throw error;
  }
}

module.exports = {
  upsertVectors,
  queryEmbeddings,
  deleteVectorsByDocumentId,
};
