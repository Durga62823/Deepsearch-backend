// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config();

const app = express();

// Configure CORS options
// The 'cors' middleware is designed to handle preflight (OPTIONS) requests automatically
// when applied with app.use().
const corsOptions = {
  origin: ["https://deepsearch-frontend-six.vercel.app", "http://localhost:5173"],
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Explicitly list methods your API uses
  allowedHeaders: ['Content-Type', 'Authorization'], // Explicitly list headers your API expects
  optionsSuccessStatus: 204 // Recommended status for successful OPTIONS requests (handled by cors)
};

// Apply CORS middleware to all requests
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/deepsearch', {})
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes');
const uploadRoutes = require('./routes/uploadRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/', (req, res) => {
    res.status(200).send('DeepSearch Backend API is running!');
});

// Generic error handling middleware
app.use((err, req, res, next) => {
  console.error('Server-wide error:', err.stack);
  res.status(500).json({ message: 'An unexpected internal server error occurred.' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});