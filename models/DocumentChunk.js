const mongoose = require('mongoose');

const DocumentChunkSchema = new mongoose.Schema({
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
  },
  chunkText: {
    type: String,
    required: true,
  },
  embeddingVector: {
    type: [Number],
    required: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('DocumentChunk', DocumentChunkSchema);