const express = require('express');
const router = express.Router();
const multer = require('multer');
const fetch = require('node-fetch');

const authMiddleware = require('../middleware/authMiddleware');
const cloudinary = require('../utils/cloudinary');
const { chunkText } = require('../utils/fileProcessor');
const pdfParse = require('pdf-parse');

const Document = require('../models/Document');

const { upsertVectors, queryEmbeddings, deleteVectorsByDocumentId } = require('../services/vectorDbService');
const { extractEntities, generateEmbedding, generateAnswer } = require('../services/aiService');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('application/pdf')) {
            cb(null, true);
        } else {
            cb(new Error('INVALID_FILE_TYPE_OR_NOT_PDF'), false);
        }
    }
});

const cleanText = (text) => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
};

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
            const chunkId = `${newDoc._id.toString()}_chunk_${i}`;
            pineconeVectors.push({
                id: chunkId,
                values: embedding,
                metadata: { text: chunk, documentId: newDoc._id.toString(), userId: req.user.id.toString() },
            });
        }
        if (pineconeVectors.length > 0) {
            await upsertVectors(pineconeVectors);
        }
        res.status(201).json(newDoc);
    } catch (error) {
        console.error("Error in /upload route:", error);
        res.status(500).json({ message: 'Server error during upload.', error: error.message });
    }
});

router.get('/', authMiddleware, async (req, res) => {
    try {
        const { filter } = req.query;
        let query = { owner: req.user.id };
        if (filter === 'favorites') {
            query.isFavorite = true;
        }
        const documents = await Document.find(query).sort({ createdAt: -1 });
        res.json({ documents });
    } catch (err) {
        console.error('Error fetching documents:', err);
        res.status(500).send('Server Error');
    }
});

router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);
        if (!document || document.owner.toString() !== req.user.id) {
            return res.status(404).json({ message: 'Document not found or not authorized' });
        }
        res.json({ document });
    } catch (err) {
        console.error('Error fetching single document:', err);
        res.status(500).send('Server Error');
    }
});

router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { isFavorite } = req.body;
        const document = await Document.findById(req.params.id);
        if (!document || document.owner.toString() !== req.user.id) {
            return res.status(404).json({ message: 'Document not found or not authorized' });
        }
        document.isFavorite = isFavorite;
        await document.save();
        res.status(200).json({ message: 'Document updated successfully', document });
    } catch (error) {
        console.error('Error updating document:', error);
        res.status(500).json({ message: 'Server error during document update.' });
    }
});

router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);
        if (!document || document.owner.toString() !== req.user.id) {
            return res.status(404).json({ message: 'Document not found or not authorized' });
        }
        if (document.cloudinaryId) {
            await cloudinary.uploader.destroy(document.cloudinaryId, { resource_type: 'raw' });
        }
        await deleteVectorsByDocumentId(document._id.toString());
        await Document.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: 'Document deleted successfully!' });
    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ message: 'Server error during deletion.' });
    }
});

router.post('/ask', authMiddleware, async (req, res) => {
    try {
        const { question, documentId } = req.body;
        const userId = req.user.id;
        if (!question) {
            return res.status(400).json({ message: 'Question is required.' });
        }
        const questionEmbedding = await generateEmbedding(question);
        const relevantChunks = await queryEmbeddings(questionEmbedding, userId, 5, documentId);
        if (relevantChunks.length === 0) {
            return res.status(200).json({ answer: "I couldn't find any relevant information in your documents to answer that question." });
        }
        const context = relevantChunks.join('\n\n');
        const answer = await generateAnswer(question, context);
        res.status(200).json({ answer });
    } catch (error) {
        console.error('Error in /ask route:', error);
        res.status(500).json({ message: 'Server error during question answering.' });
    }
});

module.exports = router;
