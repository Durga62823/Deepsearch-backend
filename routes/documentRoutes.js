const express = require('express');
const router = express.Router();
const multer = require('multer');
const fetch = require('node-fetch');

const authMiddleware = require('../middleware/authMiddleware');
const cloudinary = require('../utils/cloudinary');
const { chunkText } = require('../utils/fileProcessor');
const pdfParse = require('pdf-parse');

const Document = require('../models/Document');

const { upsertVectors, queryEmbeddings, deleteVectorsByDocumentId, checkIndexStatus, checkDocumentVectors, countVectorsByDocument } = require('../services/vectorDbService');
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
            
            // Remove the custom ID and metadata - upsertVectors will handle this
            pineconeVectors.push({
                values: embedding,
                metadata: { text: chunk }
            });
        }

        if (pineconeVectors.length > 0) {
            // FIX: Pass all three parameters
            await upsertVectors(pineconeVectors, newDoc._id.toString(), req.user.id);
            console.log(`✅ Uploaded ${pineconeVectors.length} vectors for user ${req.user.id}`);
            // Verify vectors exist in index
            try {
                const vecState = await checkDocumentVectors(newDoc._id.toString(), req.user.id);
                console.log('🧮 Post-upload vector state:', vecState);
                newDoc.isProcessed = (vecState?.countEstimate || 0) > 0;
                newDoc.vectorCountEstimate = vecState?.countEstimate || 0;
                await newDoc.save();
            } catch (ve) {
                console.warn('⚠️ Could not verify vectors after upload:', ve?.message || ve);
            }
        }

        console.log('✅ Upload successful, sending response to frontend...');
        res.status(201).json({
            message: 'Document uploaded and analyzed successfully!',
            document: newDoc
        });
    } catch (error) {
        console.error("❌ Error in /upload route:", error);
        console.error("❌ Error stack:", error.stack);
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

        console.log(`📝 Question from user ${userId}: "${question}"`);

        // Pre-checks: document exists and owned by user
        if (documentId) {
            const doc = await Document.findById(documentId);
            if (!doc || doc.owner.toString() !== userId) {
                return res.status(404).json({ message: 'Document not found or not authorized' });
            }
        }

        // Check index status first
        try {
            const stats = await checkIndexStatus();
            console.log('📊 Current index status:', stats);
        } catch (error) {
            console.error('❌ Error checking index status:', error);
        }

        // If specific document, validate vectors exist
        if (documentId) {
            try {
                const vectorState = await checkDocumentVectors(documentId, userId);
                console.log('🧮 Document vector state:', vectorState);
                if (!vectorState || (vectorState.countEstimate || 0) === 0) {
                    console.warn('⚠️ No vectors found for requested document. Falling back to user-wide search.');
                }
            } catch (vecErr) {
                console.error('❌ Error checking document vectors:', vecErr?.message || vecErr);
            }
        }

        let questionEmbedding;
        try {
            questionEmbedding = await generateEmbedding(question);
            console.log(`✅ Generated question embedding: ${questionEmbedding.length} dimensions`);
        } catch (embeddingError) {
            console.error('❌ Embedding generation failed:', embeddingError);
            return res.status(500).json({ 
                message: 'Failed to process your question. Please try again.' 
            });
        }

        let relevantChunks;
        try {
            relevantChunks = await queryEmbeddings(questionEmbedding, userId, 10, documentId);
            console.log(`🔍 Found ${relevantChunks.length} relevant chunks`);
        } catch (pineconeError) {
            console.error('❌ Pinecone query failed:', pineconeError);
            return res.status(503).json({ 
                message: 'Search service is temporarily unavailable. Please try again in a few moments.' 
            });
        }
        
        if (relevantChunks.length === 0) {
            // Try user-wide fallback explicitly if not already done inside service
            try {
                const fallback = await queryEmbeddings(questionEmbedding, userId, 15, null);
                if (fallback.length > 0) {
                    relevantChunks = fallback;
                }
            } catch {}
        }

        if (relevantChunks.length === 0) {
            // More specific error message and diagnostics
            const diag = documentId ? await (async () => {
                try { return await checkDocumentVectors(documentId, userId); } catch { return null; }
            })() : null;
            return res.status(200).json({ 
                answer: "I couldn't find relevant chunks.",
                diagnostics: {
                    documentId: documentId || null,
                    vectorCountEstimate: diag?.countEstimate ?? null,
                    sample: diag?.sample ?? null
                }
            });
        }

        const contextText = relevantChunks.map(c => c.text).join('\n\n');
        const answer = await generateAnswer(question, contextText);
        
        res.status(200).json({ answer });
    } catch (error) {
        console.error('❌ Error in /ask route:', error);
        res.status(500).json({ message: 'Server error during question answering.' });
    }
});

// Debug route: count vectors for a document
router.get('/debug/vector-count/:id', authMiddleware, async (req, res) => {
    try {
        const documentId = req.params.id;
        const userId = req.user.id;
        const doc = await Document.findById(documentId);
        if (!doc || doc.owner.toString() !== userId) {
            return res.status(404).json({ message: 'Document not found or not authorized' });
        }
        const count = await countVectorsByDocument(documentId, userId);
        const detail = await checkDocumentVectors(documentId, userId);
        res.json({ documentId, count, sample: detail?.sample || [] });
    } catch (err) {
        console.error('Error in debug vector-count:', err);
        res.status(500).json({ message: 'Failed to fetch vector count', error: err.message });
    }
});

module.exports = router;