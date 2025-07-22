const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require('../middleware/authMiddleware');

// Configure multer with improved file filtering and debugging
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
    fileFilter: (req, file, cb) => {
        // Debugging logs for mimetype
        console.log('Multer processing file:', file.originalname);
        console.log('Detected file mimetype:', file.mimetype);
        console.log('--------------------------------');

        if (file.mimetype === 'application/pdf') {
            cb(null, true); // Accept the file
        } else {
            cb(new Error('INVALID_FILE_TYPE'), false); // Using custom error type
        }
    }
});

// Upload route
router.post(
    '/upload',
    authMiddleware,
    upload.single('pdf'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: "No file uploaded" });
            }

            console.log("Received file:", req.file);

            // TODO: Add Cloudinary upload logic here
            res.status(200).json({
                message: 'File received successfully',
                filename: req.file.originalname,
                size: req.file.size
            });

        } catch (error) {
            console.error('Upload Error:', error);
            
            // Handle specific error types
            if (error.message === 'INVALID_FILE_TYPE') {
                return res.status(400).json({ 
                    message: 'Only PDF files are allowed' 
                });
            }
            
            res.status(500).json({ 
                message: 'Error uploading file',
                error: error.message 
            });
        }
    }
);

module.exports = router; 