
const pdf = require('pdf-parse');

/**
 * Extracts text content from a PDF file buffer.
 * @param {Buffer} fileBuffer - The buffer of the PDF file.
 * @returns {Promise<string>} The extracted text from the PDF.
 */
const extractTextFromPDF = async (fileBuffer) => {
  const data = await pdf(fileBuffer);
  return data.text;
};

/**
 * Splits a long text into smaller chunks of a specified size.
 * This is crucial for creating embeddings that fit within model context limits.
 * @param {string} text - The text to be chunked.
 * @param {number} chunkSize - The approximate size of each chunk (in characters).
 * @returns {string[]} An array of text chunks.
 */
const chunkText = (text, chunkSize = 1500) => {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.substring(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks;
};

module.exports = {
  extractTextFromPDF,
  chunkText,
};

