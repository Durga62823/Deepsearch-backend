const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

let pinecone;
let pineconeIndex;
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM || '384', 10);

const initializePinecone = async () => {
  try {
    if (pinecone && pineconeIndex) {
      console.log('Pinecone already initialized.');
      return;
    }

    if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
      throw new Error('Missing Pinecone environment variables. Please ensure PINECONE_API_KEY and PINECONE_INDEX_NAME are set.');
    }

    console.log('🔧 Initializing Pinecone connection...');
    console.log('📝 Index name:', process.env.PINECONE_INDEX_NAME);
    console.log('🌍 Environment:', process.env.PINECONE_ENVIRONMENT);

    pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    const indexName = process.env.PINECONE_INDEX_NAME;

    // For GCP Starter environment, use simpler initialization
    try {
      console.log('🔄 Testing Pinecone connection...');
      
      // Directly get the index without complex checks for starter environment
      pineconeIndex = pinecone.index(indexName);
      
      // Test with a simple describe call
      const stats = await pineconeIndex.describeIndexStats();
      console.log('✅ Pinecone connection successful');
      console.log(`📊 Index stats: ${stats.totalVectorCount} vectors`);
      
    } catch (error) {
      console.error('❌ Pinecone connection failed:', error.message);
      
      // For starter environment, we might need to create the index differently
      if (error.message.includes('not found') || error.message.includes('404')) {
        console.log('🔄 Creating index for starter environment...');
        
        // Starter environment has simpler index creation
        await pinecone.createIndex({
          name: indexName,
          dimension: EMBEDDING_DIM, // Must match your embedding dimension
          metric: 'cosine',
          // Starter environment doesn't need cloud/region spec
        });
        
        // Wait a bit for index to be ready
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds wait
        pineconeIndex = pinecone.index(indexName);
        console.log('✅ Index created successfully');
      } else {
        throw error;
      }
    }

    console.log('✅ Successfully connected to Pinecone and selected index.');
  } catch (error) {
    console.error('❌ Failed to initialize Pinecone:', error);
    throw new Error(`Could not initialize Pinecone connection: ${error.message}`);
  }
};

// ==================== QUERY ====================
async function queryEmbeddings(embedding, userId, topK = 10, documentId = null) {
  try {
    await initializePinecone();
    const namespace = pineconeIndex.namespace('');

    console.log(`🔍 Querying Pinecone - userId: ${userId}, documentId: ${documentId}, topK: ${topK}`);
    console.log(`📊 Embedding dimensions: ${embedding.length}`);

    // Build filter - GCP Starter supports basic filtering
    let filter;
    if (documentId) {
      filter = { 
        userId: { "$eq": userId },
        documentId: { "$eq": documentId }
      };
    } else {
      filter = { userId: { "$eq": userId } };
    }

    const queryOptions = {
      vector: embedding,
      topK: topK,
      includeMetadata: true,
      filter: filter
    };

    console.log('📋 Query options:', JSON.stringify({
      topK: queryOptions.topK,
      includeMetadata: queryOptions.includeMetadata,
      filter: queryOptions.filter,
      vector: `[${embedding.slice(0, 3).join(',')}...] (${embedding.length} dimensions)`
    }));

    const response = await namespace.query(queryOptions);
    const matches = response.matches || [];
    
    console.log(`✅ Query successful. Found ${matches.length} matches`);

    if (matches.length > 0) {
      const relevantChunks = matches.map(match => ({
        text: match.metadata?.text || '',
        score: match.score,
        documentId: match.metadata?.documentId,
        chunkIndex: match.metadata?.chunkIndex
      }));
      
      console.log('📈 Top scores:', relevantChunks.slice(0, 3).map(c => c.score?.toFixed(3)));
      return relevantChunks;
    }

    console.log('ℹ️ No matches found with current filter');
    // Fallback strategies
    // 1) If documentId filter used, relax to user-only filter
    if (documentId) {
      console.log('🔁 Fallback: relaxing filter to user-only');
      const relaxed = await namespace.query({
        vector: embedding,
        topK: Math.max(15, topK),
        includeMetadata: true,
        filter: { userId: { "$eq": userId } }
      });
      const relaxedMatches = relaxed.matches || [];
      console.log(`🔎 Relaxed filter matches: ${relaxedMatches.length}`);
      if (relaxedMatches.length > 0) {
        return relaxedMatches.map(match => ({
          text: match.metadata?.text || '',
          score: match.score,
          documentId: match.metadata?.documentId,
          chunkIndex: match.metadata?.chunkIndex
        }));
      }
    }
    // 2) As a last resort, try no filter
    console.log('🔁 Fallback: trying without any filter');
    const unfiltered = await namespace.query({
      vector: embedding,
      topK: Math.max(20, topK),
      includeMetadata: true,
    });
    const unfilteredMatches = unfiltered.matches || [];
    console.log(`🔎 Unfiltered matches: ${unfilteredMatches.length}`);
    return unfilteredMatches.map(match => ({
      text: match.metadata?.text || '',
      score: match.score,
      documentId: match.metadata?.documentId,
      chunkIndex: match.metadata?.chunkIndex
    }));

  } catch (error) {
    console.error('❌ Error querying Pinecone:', error);
    
    // Provide specific error messages for common issues
    if (error.message.includes('timeout') || error.message.includes('Connect Timeout')) {
      throw new Error('Pinecone connection timeout. Please check your network connection and try again.');
    } else if (error.message.includes('API key') || error.message.includes('auth')) {
      throw new Error('Invalid Pinecone API key. Please check your PINECONE_API_KEY environment variable.');
    } else if (error.message.includes('index not found')) {
      throw new Error('Pinecone index not found. The index may still be initializing. Please wait a moment and try again.');
    } else {
      throw new Error(`Pinecone query failed: ${error.message}`);
    }
  }
}

// ==================== UPSERT ====================
async function upsertVectors(vectors, documentId, userId) {
  try {
    await initializePinecone();
    const namespace = pineconeIndex.namespace('');

    const vectorsWithMetadata = vectors.map((vec, index) => ({
      id: `${documentId}#chunk_${index}`,
      values: vec.values,
      metadata: {
        ...vec.metadata,
        documentId,
        userId,
        chunkIndex: index,
      },
    }));

    console.log(`📤 Upserting ${vectorsWithMetadata.length} vectors to Pinecone...`);
    console.log('🧱 Sample vector (first):', {
      id: vectorsWithMetadata[0]?.id,
      metadata: vectorsWithMetadata[0]?.metadata,
      dim: vectorsWithMetadata[0]?.values?.length
    });
    console.log('🧱 Sample vector (last):', {
      id: vectorsWithMetadata[vectorsWithMetadata.length - 1]?.id,
      metadata: vectorsWithMetadata[vectorsWithMetadata.length - 1]?.metadata,
      dim: vectorsWithMetadata[vectorsWithMetadata.length - 1]?.values?.length
    });

    const maxAttempts = 3;
    let attempt = 0;
    while (attempt < maxAttempts) {
      try {
        attempt += 1;
        console.log(`🚚 Upsert attempt ${attempt}/${maxAttempts}`);
        await namespace.upsert(vectorsWithMetadata);
        console.log('⏳ Verifying upsert via index stats with filter...');
        const statsWithFilter = await pineconeIndex.describeIndexStats({
          filter: { documentId: { "$eq": documentId }, userId: { "$eq": userId } }
        });
        const estimatedCount = statsWithFilter.totalVectorCount;
        console.log('📊 Post-upsert filtered stats totalVectorCount:', estimatedCount);
        if (estimatedCount && estimatedCount > 0) {
          console.log(`✅ Upsert verified for documentId: ${documentId}, userId: ${userId}`);
          break;
        }
        if (attempt < maxAttempts) {
          const waitMs = 1000 * attempt;
          console.log(`⚠️ Verification inconclusive, retrying after ${waitMs}ms`);
          await new Promise(r => setTimeout(r, waitMs));
        } else {
          console.warn('⚠️ Unable to verify upsert via stats. Proceeding but vectors may not be immediately queryable.');
        }
      } catch (innerErr) {
        console.error(`❌ Upsert attempt ${attempt} failed:`, innerErr.message);
        if (attempt >= maxAttempts) throw innerErr;
        const waitMs = 1500 * attempt;
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    console.log(`✅ Upserted ${vectorsWithMetadata.length} vectors with documentId: ${documentId} for userId: ${userId}`);
  } catch (error) {
    console.error('❌ Error upserting vectors:', error);
    throw error;
  }
}
async function checkDocumentVectors(documentId, userId) {
  try {
    await initializePinecone();
    const namespace = pineconeIndex.namespace('');
    // Try stats with filter
    const statsFiltered = await pineconeIndex.describeIndexStats({
      filter: {
        documentId: { "$eq": documentId },
        ...(userId ? { userId: { "$eq": userId } } : {})
      }
    });
    const filteredCount = statsFiltered.totalVectorCount || 0;
    console.log('📊 describeIndexStats (filtered) totalVectorCount:', filteredCount);

    // Probe query using a zero vector to fetch sample metadata
    const dim = EMBEDDING_DIM;
    const zeroVec = Array(dim).fill(0.0);
    const probe = await namespace.query({
      vector: zeroVec,
      topK: 5,
      includeMetadata: true,
      filter: {
        documentId: { "$eq": documentId },
        ...(userId ? { userId: { "$eq": userId } } : {})
      }
    });
    const sample = (probe.matches || []).map(m => ({ id: m.id, metadata: m.metadata })).slice(0, 3);
    return { countEstimate: filteredCount, sample };
  } catch (error) {
    console.error('❌ Error checking document vectors:', error.message);
    throw error;
  }
}
async function countVectorsByDocument(documentId, userId) {
  const result = await checkDocumentVectors(documentId, userId);
  return result.countEstimate || 0;
}
async function checkIndexStatus() {
  try {
    await initializePinecone();
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

// ==================== DELETE ====================
async function deleteVectorsByDocumentId(documentId) {
  try {
    await initializePinecone();
    const namespace = pineconeIndex.namespace('');
    
    console.log(`🗑️ Deleting vectors for document: ${documentId}`);
    
    // For starter environment, use deleteAll with filter
    await namespace.deleteMany({
      filter: {
        documentId: { "$eq": documentId }
      }
    });
    
    console.log(`✅ Successfully deleted vectors for document ID: ${documentId}`);
  } catch (error) {
    console.error('❌ Error deleting vectors from Pinecone:', error);
    throw error;
  }
}

module.exports = {
  initializePinecone,
  upsertVectors,
  queryEmbeddings,
  deleteVectorsByDocumentId,
  checkIndexStatus,
  checkDocumentVectors,
  countVectorsByDocument
};