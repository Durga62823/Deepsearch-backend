const express = require('express');
const router = express.Router();
const multer = require('multer');
const fetch = require('node-fetch');

// Middleware and Utilities
const authMiddleware = require('../middleware/authMiddleware');
const cloudinary = require('../utils/cloudinary');
const { chunkText } = require('../utils/fileProcessor');
const pdfParse = require('pdf-parse');

// Models
const Document = require('../models/Document');

// Services
const { storeEmbeddings, queryEmbeddings } = require('../services/vectorDbService');
const { extractEntities, generateEmbedding, generateAnswer } = require('../services/aiService');

// --- Multer Configuration ---
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('application/pdf')) {
            cb(null, true);
        } else {
            cb(new Error('INVALID_FILE_TYPE_OR_NOT_PDF'), false);
        }
    }
});

// --- Helper Function ---
const cleanText = (text) => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
};

// --- ROUTES ---

// Upload and Process a Document
router.post('/upload', authMiddleware, upload.single('pdf'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ message: 'No file was uploaded.' });
        }
        
        const cloudinaryUploadPromise = () => new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder: 'deepsearch_pdfs',
                    resource_type: 'raw',
                    format: 'pdf',
                    public_id: `pdf-${Date.now()}-${file.originalname.split('.')[0].replace(/[^a-zA-Z0-9-]/g, '_')}`
                },
                (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                }
            );
            stream.end(req.file.buffer);
        });
        const cloudinaryResult = await cloudinaryUploadPromise();

        const rawText = (await pdfParse(file.buffer)).text;
        const cleanedText = cleanText(rawText);
        
        const extractedEntities = await extractEntities(cleanedText);

        const newDoc = new Document({
            title: file.originalname,
            cloudinaryUrl: cloudinaryResult.secure_url,
            cloudinaryId: cloudinaryResult.public_id,
            rawText: rawText,
            cleanedText: cleanedText,
            owner: req.user.id,
            entities: extractedEntities
        });
        await newDoc.save();

        const textChunks = chunkText(cleanedText);
        const pineconeVectors = [];
        for (let i = 0; i < textChunks.length; i++) {
            const chunk = textChunks[i];
            const embedding = await generateEmbedding(chunk);
            const chunkId = `${newDoc._id}_chunk_${i}`;

            pineconeVectors.push({
                id: chunkId,
                values: embedding,
                metadata: { text: chunk, documentId: newDoc._id.toString(), userId: req.user.id },
            });
        }
        
        if (pineconeVectors.length > 0) {
            await storeEmbeddings(pineconeVectors);
        }

        res.status(201).json(newDoc);
    } catch (error) {
        console.error("Error in /upload route:", error);
        res.status(500).json({ message: 'Server error during upload.', error: error.message });
    }
});

// Get all documents for the logged-in user
router.get('/', authMiddleware, async (req, res) => {
    try {
        const documents = await Document.find({ owner: req.user.id }).sort({ createdAt: -1 });
        res.json(documents);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// Get a specific document by ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);
        if (!document || document.owner.toString() !== req.user.id) {
            return res.status(404).json({ message: 'Document not found or not authorized' });
        }
        res.json(document);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// Delete a document
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);
        if (!document || document.owner.toString() !== req.user.id) {
            return res.status(404).json({ message: 'Document not found or not authorized' });
        }
        if (document.cloudinaryId) {
            await cloudinary.uploader.destroy(document.cloudinaryId, { resource_type: 'raw' });
        }
        await Document.findByIdAndDelete(req.params.id);
        // Note: You should also delete the corresponding vectors from Pinecone here for a complete solution.
        res.status(200).json({ message: 'Document deleted successfully!' });
    } catch (error) {
        res.status(500).json({ message: 'Server error during deletion.' });
    }
});

// Ask a question across all of the user's documents
router.post('/ask', authMiddleware, async (req, res) => {
    try {
        const { question } = req.body;
        const userId = req.user.id;

        if (!question) {
            return res.status(400).json({ message: 'Question is required.' });
        }

        const questionEmbedding = await generateEmbedding(question);

        const relevantChunks = await queryEmbeddings(questionEmbedding, userId, 5);
        
        if (relevantChunks.length === 0) {
            return res.status(200).json({ answer: "I couldn't find any relevant information in your documents to answer that question." });
        }

        const context = relevantChunks.join('\n\n');
        const answer = await generateAnswer(question, context);

        res.status(200).json({ answer });
    } catch (error) {
        console.error('Error in general /ask route:', error);
        res.status(500).json({ message: 'Server error during question answering.' });
    }
});

module.exports = router;
