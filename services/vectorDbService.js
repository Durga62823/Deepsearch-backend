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

async function upsertVectors(vectors, documentId, userId) {
  try {
    console.log(`� Upserting ${vectors.length} vectors to Pinecone index: ${indexName}...`);
    
    // Ensure vectors have proper format with metadata
    const formattedVectors = vectors.map((vec, index) => ({
      id: vec.id || `${documentId}#chunk_${index}`,
      values: vec.values,
      metadata: {
        ...vec.metadata,
        documentId: documentId,
        userId: userId,
        chunkIndex: index,
      },
    }));

    await pineconeIndex.upsert(formattedVectors);
    console.log(`✅ Successfully upserted ${vectors.length} vectors to Pinecone index: ${indexName}.`);
    
    // Wait for Pinecone to index vectors (eventual consistency)
    console.log('⏳ Waiting for Pinecone to index vectors...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second wait
    
  } catch (error) {
    console.error('❌ Error upserting vectors to Pinecone:', error);
    throw error;
  }
}

async function queryEmbeddings(embedding, userId, topK = 10, documentId = null) {
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

    console.log(`� Querying Pinecone - userId: ${userId}, documentId: ${documentId}, topK: ${topK}`);

    const queryResponse = await pineconeIndex.query(queryOptions);

    const relevantChunks = queryResponse.matches.map(match => ({
      text: match.metadata?.text || '',
      score: match.score,
      documentId: match.metadata?.documentId,
      chunkIndex: match.metadata?.chunkIndex
    }));
    
    console.log(`✅ Found ${relevantChunks.length} relevant chunks for query.`);
    return relevantChunks;
  } catch (error) {
    console.error('❌ Error querying Pinecone embeddings:', error);
    throw error;
  }
}

async function deleteVectorsByDocumentId(documentId) {
  try {
    console.log(`🗑️ Deleting vectors for document: ${documentId}`);
    
    // First, fetch all vector IDs for this document using a query
    const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM || '768', 10);
    const zeroVec = Array(EMBEDDING_DIM).fill(0.0);
    
    // Query to get all vectors for this document
    const queryResult = await pineconeIndex.query({
      vector: zeroVec,
      topK: 10000, // Large number to get all vectors
      includeMetadata: true,
      filter: {
        documentId: { '$eq': documentId }
      }
    });
    
    const vectorIds = queryResult.matches.map(match => match.id);
    
    if (vectorIds.length === 0) {
      console.log(`ℹ️ No vectors found for document: ${documentId}`);
      return;
    }
    
    console.log(`🔍 Found ${vectorIds.length} vector IDs to delete`);
    
    // Delete by IDs (Pinecone supports this)
    await pineconeIndex.deleteMany(vectorIds);
    
    console.log(`✅ Successfully deleted ${vectorIds.length} vectors for document ID: ${documentId} from Pinecone index: ${indexName}.`);
  } catch (error) {
    console.error('❌ Error deleting vectors from Pinecone:', error);
    throw error;
  }
}

async function checkIndexStatus() {
  try {
    const stats = await pineconeIndex.describeIndexStats();
    console.log('📊 Pinecone Index Stats:', {
      totalVectors: stats.totalVectorCount,
      dimension: stats.dimension,
      indexFullness: stats.indexFullness
    });
    return stats;
  } catch (error) {
    console.error('❌ Error checking index stats:', error);
    throw error;
  }
}

async function checkDocumentVectors(documentId, userId) {
  try {
    console.log(`🔍 Checking vectors for document: ${documentId}, user: ${userId}`);
    
    // Query using a zero vector to fetch sample metadata
    const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM || '768', 10);
    const zeroVec = Array(EMBEDDING_DIM).fill(0.0);
    
    const filter = {
      documentId: { '$eq': documentId }
    };
    
    if (userId) {
      filter.userId = { '$eq': userId };
    }
    
    const probe = await pineconeIndex.query({
      vector: zeroVec,
      topK: 5,
      includeMetadata: true,
      filter: filter
    });
    
    const matches = probe.matches || [];
    const sample = matches.map(m => ({ 
      id: m.id, 
      metadata: m.metadata 
    })).slice(0, 3);
    
    console.log(`✅ Found ${matches.length} vectors for document`);
    
    return { 
      countEstimate: matches.length, 
      sample: sample 
    };
  } catch (error) {
    console.error('❌ Error checking document vectors:', error.message);
    throw error;
  }
}

async function countVectorsByDocument(documentId, userId) {
  try {
    const result = await checkDocumentVectors(documentId, userId);
    return result.countEstimate || 0;
  } catch (error) {
    console.error('❌ Error counting vectors:', error.message);
    return 0;
  }
}

module.exports = {
  upsertVectors,
  queryEmbeddings,
  deleteVectorsByDocumentId,
  checkIndexStatus,
  checkDocumentVectors,
  countVectorsByDocument,
};