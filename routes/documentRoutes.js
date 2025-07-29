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
            const parsedEntities = JSON.parse(jsonString);

            if (Array.isArray(parsedEntities)) {
                return parsedEntities.filter(e => typeof e.text === 'string' && ['PERSON', 'ORG', 'LOCATION'].includes(e.type));
            } else {
                return [];
            }
        } else {
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
        if (file.mimetype && file.mimetype.startsWith('application/pdf')) {
            cb(null, true);
        } else {
            cb(new Error('INVALID_FILE_TYPE_OR_NOT_PDF'), false);
        }
    }
});

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
        let rawText = '';
        try {
            const data = await pdfParse(file.buffer);
            rawText = data.text;
        } catch (pdfParseErr) {
            rawText = '[PDF TEXT EXTRACTION FAILED]';
        }

        const cleanedText = cleanText(rawText);
        let extractedEntities = [];
        if (cleanedText.length > 0 && cleanedText !== '[PDF TEXT EXTRACTION FAILED]') {
            extractedEntities = await extractEntitiesWithGemini(cleanedText);
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
        res.status(201).json(newDoc);
    } catch (error) {
        res.status(500).json({ message: 'Server error during upload.', error: error.message });
    }
});

router.get('/', authMiddleware, async (req, res) => {
    try {
        const documents = await Document.find({ owner: req.user.id }).sort({ uploadedAt: -1 });
        res.json(documents);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

router.get('/:id/download', authMiddleware, async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);
        if (!document || document.owner.toString() !== req.user.id) {
            return res.status(404).json({ message: 'Document not found or not authorized' });
        }
        const response = await fetch(document.cloudinaryUrl);
        if (!response.ok) {
            return res.status(500).json({ message: 'Failed to retrieve PDF from storage' });
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${document.title}"`);
        response.body.pipe(res);
    } catch (err) {
        res.status(500).send('Server Error during PDF download');
    }
});

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
        res.status(200).json({ message: 'Document deleted successfully!' });
    } catch (error) {
        res.status(500).json({ message: 'Server error during deletion.' });
    }
});

router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { isFavorite } = req.body;
        const document = await Document.findOneAndUpdate(
            { _id: req.params.id, owner: req.user.id },
            { isFavorite },
            { new: true }
        );
        if (!document) {
            return res.status(404).json({ message: 'Document not found or not authorized' });
        }
        res.status(200).json({ message: 'Document updated successfully', document });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
