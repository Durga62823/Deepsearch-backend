// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController'); // Ensure correct path

// Signup route - This is the correct route for your signup logic
router.post('/signup', authController.signup);

// Login route
router.post('/login', authController.login);

module.exports = router;