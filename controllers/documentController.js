const Document = require('../models/Document');
const DocumentChunk = require('../models/DocumentChunk');
const { extractTextFromPDF, chunkText } = require('../utils/fileProcessor');
const { generateEmbedding, generateAnswer } = require('../services/aiService');
const { storeEmbeddings, queryEmbeddings } = require('../services/vectorDbService');

const uploadAndProcessDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    const document = new Document({
      filename: req.file.originalname,
      user: req.user.id,
    });
    await document.save();

    const text = await extractTextFromPDF(req.file.buffer);
    const chunks = chunkText(text);

    const pineconeVectors = [];
    const mongoDbChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await generateEmbedding(chunk);
      const chunkId = `${document._id}_chunk_${i}`;
      pineconeVectors.push({
        id: chunkId,
        values: embedding,
        metadata: { text: chunk, documentId: document._id.toString() },
      });
      mongoDbChunks.push({
        documentId: document._id,
        chunkText: chunk,
        embeddingVector: embedding,
      });
    }

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

const askQuestion = async (req, res) => {
  try {
    const { question } = req.body;
    const { documentId } = req.params;

    if (!question) {
      return res.status(400).json({ message: 'Question is required.' });
    }

    const questionEmbedding = await generateEmbedding(question);
    const relevantChunks = await queryEmbeddings(questionEmbedding, 3);
    const context = relevantChunks.join('\n\n');
    const answer = await generateAnswer(question, context);
    res.status(200).json({ answer });
  } catch (error) {
    console.error('Error in askQuestion:', error);
    res.status(500).json({ message: 'Server error during question answering.' });
  }
};

module.exports = {
  uploadAndProcessDocument,
  askQuestion,
};