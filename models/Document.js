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
  cloudinaryId: { // Added: Stores the unique ID from Cloudinary for managing the uploaded file
    type: String,
    required: true
  },
  rawText: {
    type: String,
    required: false // Changed: Made optional as PDF text extraction might fail
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

  entities: [ // Retained and confirmed the detailed schema for entities
    {
      text: String,
      type: { // Represents the type of entity (e.g., PERSON, ORG)
        type: String,
        enum: ['PERSON', 'ORG', 'LOCATION'], // Enforces specific types
        required: true
      }
    }
  ],
 
}, { timestamps: true }); // Retained: Automatically adds createdAt and updatedAt fields

module.exports = mongoose.model('Document', documentSchema);
