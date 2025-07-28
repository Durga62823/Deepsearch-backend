// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config();

const app = express();

// Configure CORS options explicitly for preflight requests
const corsOptions = {
  origin: ["https://deepsearch-frontend-six.vercel.app", "http://localhost:5173"],
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Explicitly allowed methods for preflight
  preflightContinue: false, // Set to false to let cors middleware handle preflight
  optionsSuccessStatus: 204 // Recommended status for successful OPTIONS requests
};


app.use(cors(corsOptions));

app.options('*', cors(corsOptions)); // Enable pre-flight across-the-board for all routes

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