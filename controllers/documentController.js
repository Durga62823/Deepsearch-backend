const Document = require('../models/Document');
const DocumentChunk = require('../models/DocumentChunk'); // NEW
const { extractTextFromPDF, chunkText } = require('../utils/fileProcessor'); // NEW
const { generateEmbedding, generateAnswer } = require('../services/aiService'); // NEW
const { storeEmbeddings, queryEmbeddings } = require('../services/vectorDbService'); // NEW

const uploadAndProcessDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    // --- 1. Save initial document metadata to MongoDB ---
    const document = new Document({
      filename: req.file.originalname,
      user: req.user.id, // Assuming auth middleware provides req.user
      // Add other metadata like Cloudinary URL if you still store the original file
    });
    await document.save();

    // --- 2. Process the file content ---
    const text = await extractTextFromPDF(req.file.buffer);
    const chunks = chunkText(text);

    // --- 3. Generate embeddings and prepare for storage ---
    const pineconeVectors = [];
    const mongoDbChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await generateEmbedding(chunk);
      
      const chunkId = `${document._id}_chunk_${i}`;

      // Prepare vector for Pinecone
      pineconeVectors.push({
        id: chunkId,
        values: embedding,
        metadata: { text: chunk, documentId: document._id.toString() },
      });

      // Prepare chunk for MongoDB (optional, but good for reference)
      mongoDbChunks.push({
        documentId: document._id,
        chunkText: chunk,
        embeddingVector: embedding,
      });
    }

    // --- 4. Store embeddings in Pinecone and chunks in MongoDB ---
    if (pineconeVectors.length > 0) {
      await storeEmbeddings(pineconeVectors);
    }
    if (mongoDbChunks.length > 0) {
      await DocumentChunk.insertMany(mongoDbChunks);
    }

    res.status(201).json({
      message: 'Document uploaded and processed successfully.',
      document,
    });
  } catch (error) {
    console.error('Error in uploadAndProcessDocument:', error);
    res.status(500).json({ message: 'Server error during document processing.' });
  }
};

// --- This is the NEW function for handling questions ---
const askQuestion = async (req, res) => {
  try {
    const { question } = req.body;
    const { documentId } = req.params;

    if (!question) {
      return res.status(400).json({ message: 'Question is required.' });
    }

    // 1. Create an embedding for the user's question
    const questionEmbedding = await generateEmbedding(question);

    // 2. Query Pinecone to find the most relevant text chunks
    const relevantChunks = await queryEmbeddings(questionEmbedding, 3);
    const context = relevantChunks.join('\n\n'); // Combine chunks into a single context

    // 3. Generate an answer using the context and question
    const answer = await generateAnswer(question, context);

    res.status(200).json({ answer });
  } catch (error) {
    console.error('Error in askQuestion:', error);
    res.status(500).json({ message: 'Server error during question answering.' });
  }
};


// Make sure to export the new functions along with your existing ones
module.exports = {
  // ... your other existing controller functions (getDocuments, deleteDocument, etc.)
  uploadAndProcessDocument, // Use this as your new upload handler
  askQuestion,
};