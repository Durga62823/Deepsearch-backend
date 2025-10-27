const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  cloudinaryUrl: {
    type: String,
    required: true
  },
  cloudinaryId: {
    type: String,
    required: true
  },
  rawText: {
    type: String,
    required: false
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cleanedText: {
    type: String,
    required: false
  },
  entities: {
    type: [
      {
        text: { type: String, required: true },
        type: {
          type: String,
          enum: ['PERSON', 'ORG', 'LOCATION'],
          required: true
        }
      }
    ],
    default: []
  },
  isProcessed: {
    type: Boolean,
    default: false
  },
  vectorCountEstimate: {
    type: Number,
    default: 0
  }

}, { timestamps: true });

module.exports = mongoose.model('Document', documentSchema);
