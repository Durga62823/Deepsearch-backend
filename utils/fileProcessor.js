
const pdf = require('pdf-parse');

const extractTextFromPDF = async (fileBuffer) => {
  const data = await pdf(fileBuffer);
  return data.text;
};

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

