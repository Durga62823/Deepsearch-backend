// routes/documentRoutes.js

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
    // ... (your existing function for Gemini)
};

const upload = multer({
    storage: multer.memoryStorage(),
    // ... (your existing multer config)
});

router.post('/upload', authMiddleware, upload.single('pdf'), async (req, res) => {
    // ... (your existing upload logic)
});

router.get('/', authMiddleware, async (req, res) => {
    // ... (your existing logic to get all documents)
});

// This is the route the frontend now correctly calls
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
      console.error('Server Error during PDF download:', err);
      res.status(500).send('Server Error during PDF download');
  }
});

// This route provides metadata, not the file itself
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
    // ... (your existing delete logic)
});

router.put('/:id', authMiddleware, async (req, res) => {
    // ... (your existing update logic)
});

module.exports = router;
