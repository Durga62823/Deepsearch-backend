const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

let pinecone;
let pineconeIndex;

const initializePinecone = async () => {
  try {
    if (pinecone && pineconeIndex) {
      console.log('Pinecone already initialized.');
      return;
    }


    if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {

      throw new Error('Missing Pinecone environment variables. Please ensure PINECONE_API_KEY and PINECONE_INDEX_NAME are set in your .env file.');
    }


    pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    
    });

    const indexName = process.env.PINECONE_INDEX_NAME;
    
    const listIndexesResponse = await pinecone.listIndexes();
    const indexExists = listIndexesResponse.indexes?.some(index => index.name === indexName);

    if (!indexExists) {
      console.log(`Pinecone index '${indexName}' does not exist. Creating it...`);
      await pinecone.createIndex({
        name: indexName,
        dimension: 768, 
        metric: 'cosine',
        spec: { 
          serverless: { 
            cloud: 'aws', 
            region: process.env.PINECONE_REGION || 'us-west-2'
          }
        }
      });
      console.log(`Pinecone index '${indexName}' created.`);
    }


    pineconeIndex = pinecone.Index(indexName);
    console.log('Successfully connected to Pinecone and selected index.');
  } catch (error) {
    console.error('Failed to initialize Pinecone:', error);

    throw new Error('Could not initialize Pinecone connection. Check your API Key and Index Name, and ensure your Pinecone client library is up to date and configured correctly.');
  }
};

async function upsertVectors(vectors) {
  try {
    await initializePinecone();
    await pineconeIndex.upsert(vectors);
    console.log(`Successfully upserted ${vectors.length} vectors to Pinecone index: ${process.env.PINECONE_INDEX_NAME}.`);
  } catch (error) {
    console.error('Error upserting vectors to Pinecone:', error);
    throw error; 
  }
}

async function queryEmbeddings(embedding, userId, topK = 5, documentId = null) {
  try {
    await initializePinecone();

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
    await initializePinecone(); 
    await pineconeIndex.delete1({
      filter: {
        documentId: { '$eq': documentId }
      }
    });
    console.log(`Successfully deleted vectors for document ID: ${documentId} from Pinecone index: ${process.env.PINECONE_INDEX_NAME}.`);
  } catch (error) {
    console.error('Error deleting vectors from Pinecone:', error);
    throw error; 
  }
}

module.exports = {
  initializePinecone,
  upsertVectors,
  queryEmbeddings,
  deleteVectorsByDocumentId,
};
