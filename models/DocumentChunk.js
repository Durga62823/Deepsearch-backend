const mongoose = require('mongoose');

const DocumentChunkSchema = new mongoose.Schema({
  // A reference to the original document this chunk belongs to.
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
  },
  // The actual piece of text.
  chunkText: {
    type: String,
    required: true,
  },
  // The vector embedding (a numerical representation of the text).
  embeddingVector: {
    type: [Number], // An array of numbers
    required: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('DocumentChunk', DocumentChunkSchema);