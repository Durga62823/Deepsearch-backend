const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require('../middleware/authMiddleware');
const https = require('https');
const http = require('http');
const cloudinary = require('../utils/cloudinary');
const Document = require('../models/Document');
const pdfParse = require('pdf-parse');
const streamifier = require('streamifier');
const fetch = require('node-fetch');

const cleanText = (text) => {
    if (!text) return '';
    let cleaned = text.replace(/\s+/g, ' ').trim();
    return cleaned;
};

const extractEntitiesWithGemini = async (text) => {
    const maxTextLength = 10000;
    const textForLLM = text.substring(0, Math.min(text.length, maxTextLength));
    let chatHistory = [];
    const prompt = `Extract named entities (PERSON, ORG, LOCATION) from the following text.
                    Provide the output as a JSON array where each object has 'text' (the entity name)
                    and 'type' (one of PERSON, ORG, LOCATION). If no entities are found, return an empty array.

                    Text: "${textForLLM}"`;
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });
    const payload = {
        contents: chatHistory,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        "text": { "type": "STRING" },
                        "type": { "type": "STRING", "enum": ["PERSON", "ORG", "LOCATION"] }
                    },
                    "propertyOrdering": ["text", "type"]
                }
            }
        }
    };
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("GEMINI_API_KEY is not set in environment variables. Entity extraction skipped.");
        return [];
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    try {
        console.log('Calling Gemini API for entity extraction...');
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorBody}`);
        }
        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const jsonString = result.candidates[0].content.parts[0].text;
            console.log('Gemini raw response:', jsonString);
            const parsedEntities = JSON.parse(jsonString);
            if (Array.isArray(parsedEntities)) {
                return parsedEntities.filter(e => typeof e.text === 'string' && ['PERSON', 'ORG', 'LOCATION'].includes(e.type));
            } else {
                console.warn('Gemini response was not a valid array of entities:', parsedEntities);
                return [];
            }
        } else {
            console.warn('Gemini API returned no candidates or content.');
            return [];
        }
    } catch (apiError) {
        console.error('Error calling Gemini API for entities:', apiError);
        return [];
    }
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        console.log('--- Multer File Filter Debug ---');
        console.log('File originalname:', file.originalname);
        console.log('Detected file mimetype by Multer:', file.mimetype);
        console.log('-----------------------------------');
        if (file.mimetype && file.mimetype.startsWith('application/pdf')) {
            cb(null, true);
        } else {
            cb(new Error('INVALID_FILE_TYPE_OR_NOT_PDF'), false);
        }
    }
});

router.post(
    '/upload',
    authMiddleware,
    upload.single('pdf'),
    async (req, res) => {
        try {
            const file = req.file;
            if (!file) {
                console.log('Error: No file object found on req.file after Multer processing.');
                return res.status(400).json({ message: 'No file was uploaded or processed successfully.' });
            }
            if (!file.mimetype || !file.mimetype.startsWith('application/pdf')) {
                console.log(`Error: Mimetype '${file.mimetype}' bypassed fileFilter or is not a PDF upon final check.`);
                return res.status(400).json({ message: 'The uploaded file is not a valid PDF document.' });
            }
            console.log("Received file for upload:", file.originalname);
            const cloudinaryUploadPromise = () => new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                        folder: 'deepsearch_pdfs',
                        resource_type: 'raw',
                        format: 'pdf',
                        public_id: `pdf-${Date.now()}-${file.originalname.split('.')[0].replace(/[^a-zA-Z0-9-]/g, '_')}`,
                        access_mode: 'public'
                    },
                    (error, result) => {
                        if (error) {
                            console.error('Cloudinary upload stream error:', error);
                            return reject(error);
                        }
                        resolve(result);
                    }
                );
                stream.end(req.file.buffer);
            });
            const cloudinaryResult = await cloudinaryUploadPromise();
            console.log('Cloudinary Upload successful. Secure URL:', cloudinaryResult.secure_url);
            let rawText = '';
            try {
                const data = await pdfParse(file.buffer);
                rawText = data.text;
                console.log(`PDF text extraction successful. Extracted ${rawText.length} characters.`);
            } catch (pdfParseErr) {
                console.warn('Warning: PDF text parsing failed for', file.originalname, 'Error:', pdfParseErr.message);
                rawText = '[PDF TEXT EXTRACTION FAILED]';
            }
            const cleanedText = cleanText(rawText);
            let extractedEntities = [];
            if (cleanedText.length > 0 && cleanedText !== '[PDF TEXT EXTRACTION FAILED]') {
                try {
                    extractedEntities = await extractEntitiesWithGemini(cleanedText);
                    console.log(`Extracted ${extractedEntities.length} entities.`);
                } catch (entityError) {
                    console.error('Error during entity extraction:', entityError);
                }
            } else {
                console.log('Skipping entity extraction: No cleaned text available.');
            }
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
            console.log('Document saved to MongoDB. Document ID:', newDoc._id);
            res.status(201).json({
                message: 'Document uploaded and processed successfully (including preprocessing).',
                document: {
                    id: newDoc._id,
                    title: newDoc.title,
                    cloudinaryUrl: newDoc.cloudinaryUrl,
                    rawTextPreview: newDoc.rawText.substring(0, Math.min(newDoc.rawText.length, 100)) + (newDoc.rawText.length > 100 ? '...' : ''),
                    cleanedTextPreview: newDoc.cleanedText ? (newDoc.cleanedText.substring(0, Math.min(newDoc.cleanedText.length, 100)) + (newDoc.cleanedText.length > 100 ? '...' : '')) : 'N/A',
                    entitiesCount: newDoc.entities.length,
                    owner: newDoc.owner,
                    uploadedAt: newDoc.uploadedAt
                },
            });
        } catch (error) {
            console.error('Full Document Upload Process Error:', error);
            if (error.message === 'INVALID_FILE_TYPE_OR_NOT_PDF') {
                return res.status(400).json({ message: 'The uploaded file is not a valid PDF document.' });
            }
            if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Authentication failed: Invalid or expired token.' });
            }
            res.status(500).json({
                message: 'An internal server error occurred during the document upload process.',
                error: error.message
            });
        }
    }
);

router.get('/', authMiddleware, async (req, res) => {
    try {
        const { filter } = req.query;
        const query = { owner: req.user.id };
        if (filter === 'favorites') {
            query.isFavorite = true;
        }
        const documents = await Document.find(query).sort({ uploadedAt: -1 });
        res.json(documents);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.get('/:id/download', authMiddleware, async (req, res) => {
    console.log(`Backend: Entering GET /api/documents/:id/download route handler for ID: ${req.params.id}`);
    try {
        const document = await Document.findById(req.params.id);
        if (!document) {
            console.log(`Backend: Document with ID ${req.params.id} not found.`);
            return res.status(404).json({ message: 'Document not found' });
        }
        if (document.owner.toString() !== req.user.id) {
            console.log(`Backend: User ${req.user.id} not authorized for document ${req.params.id}.`);
            return res.status(401).json({ message: 'Not authorized to view this document' });
        }
        console.log(`Backend: Fetching PDF from Cloudinary URL: ${document.cloudinaryUrl}`);
        let response;
        try {
            response = await fetch(document.cloudinaryUrl);
            console.log(`Backend: Cloudinary response status for download: ${response.status}`);
        } catch (fetchError) {
            console.error(`Backend: Fetch error during download:`, fetchError);
            return res.status(500).json({ message: 'Failed to connect to storage service for download' });
        }
        if (!response.ok) {
            console.error(`Backend: Failed to fetch PDF from Cloudinary for download: ${response.status} ${response.statusText}`);
            try {
                const errorText = await response.text();
                console.error(`Backend: Cloudinary error response during download:`, errorText);
            } catch (textError) {
                console.error(`Backend: Could not read error response text during download:`, textError);
            }
            return res.status(500).json({ message: 'Failed to retrieve PDF from storage for download' });
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${document.title}"`);
        res.setHeader('Cache-Control', 'no-cache');
        console.log(`Backend: Streaming PDF to client for download...`);
        response.body.pipe(res);
    } catch (err) {
        console.error(`Backend: ERROR in GET /api/documents/:id/download route for ID ${req.params.id}:`, err);
        if (err.kind === 'ObjectId') {
            return res.status(400).json({ message: 'Invalid document ID' });
        }
        res.status(500).send('Server Error during PDF download');
    }
});

router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);
        if (!document) {
            return res.status(404).json({ message: 'Document not found' });
        }
        if (document.owner.toString() !== req.user.id) {
            return res.status(401).json({ message: 'Not authorized to view this document' });
        }
        res.json(document);
    } catch (err) {
        console.error(err.message);
        if (err.kind === 'ObjectId') {
            return res.status(400).json({ message: 'Invalid document ID' });
        }
        res.status(500).send('Server Error');
    }
});

router.delete('/:id', authMiddleware, async (req, res) => {
    console.log(`Backend: Entering DELETE /api/documents/:id route handler for ID: ${req.params.id}`);
    try {
        const documentId = req.params.id;
        console.log(`Backend: Attempting to find document with ID: ${documentId}`);
        const document = await Document.findById(documentId);
        if (!document) {
            console.log(`Backend: Document with ID ${documentId} not found.`);
            return res.status(404).json({ message: 'Document not found.' });
        }
        console.log(`Backend: Document found: ${document.title}`);
        console.log(`Backend: Verifying ownership. Document owner: ${document.owner}, Requesting user: ${req.user.id}`);
        if (document.owner.toString() !== req.user.id) {
            console.log(`Backend: Unauthorized attempt to delete document ${documentId} by user ${req.user.id}.`);
            return res.status(401).json({ message: 'Not authorized to delete this document.' });
        }
        console.log('Backend: Ownership verified.');
        if (document.cloudinaryId) {
            console.log(`Backend: Deleting Cloudinary asset with ID: ${document.cloudinaryId}`);
            try {
                const cloudinaryDeletionResult = await cloudinary.uploader.destroy(document.cloudinaryId, { resource_type: 'raw' });
                console.log('Cloudinary deletion result:', cloudinaryDeletionResult);
                if (cloudinaryDeletionResult.result !== 'ok') {
                    console.warn(`Backend: Cloudinary deletion for ${document.cloudinaryId} returned status: '${cloudinaryDeletionResult.result}'`);
                } else {
                    console.log(`Backend: Cloudinary asset ${document.cloudinaryId} successfully deleted.`);
                }
            } catch (cloudinaryErr) {
                console.error('Backend: Error deleting from Cloudinary:', cloudinaryErr);
            }
        } else {
            console.log(`Backend: No Cloudinary ID found for document ${documentId}. Skipping Cloudinary deletion.`);
        }
        console.log(`Backend: Deleting document ${documentId} from MongoDB.`);
        await Document.findByIdAndDelete(documentId);
        console.log(`Backend: Document ${documentId} successfully deleted from MongoDB.`);
        res.status(200).json({ message: 'Document deleted successfully!' });
        console.log('Backend: Response sent for successful deletion.');
    } catch (error) {
        console.error('Backend: !!! ERROR during document DELETE route handler:', error);
        if (error.kind === 'ObjectId') {
            return res.status(400).json({ message: 'Invalid document ID format.' });
        }
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Authentication failed: Invalid or expired token.' });
        }
        res.status(500).json({
            message: 'An internal server error occurred during document deletion.',
            error: error.message
        });
    }
});

router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { isFavorite } = req.body;
        const document = await Document.findById(id);
        if (!document) {
            return res.status(404).json({ message: 'Document not found' });
        }
        if (document.owner.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to update this document' });
        }
        document.isFavorite = isFavorite;
        await document.save();
        res.status(200).json({ message: 'Document updated successfully', document });
    } catch (error) {
        console.error('Error updating document:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
