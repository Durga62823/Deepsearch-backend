
const pdf = require('pdf-parse');

const extractTextFromPDF = async (fileBuffer) => {
  const data = await pdf(fileBuffer);
  return data.text;
};

const chunkText = (text, chunkSize = 500, overlap = 100) => {
  const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];
  const chunks = [];
  let currentChunk = '';
  let currentTokenCount = 0;

  for (const sentence of sentences) {
    const sentenceTokenCount = sentence.split(/\s+/).length;
    
    if (currentTokenCount + sentenceTokenCount > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-overlap);
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
      currentTokenCount = overlapWords.length + sentenceTokenCount;
    } else {
      currentChunk += ' ' + sentence;
      currentTokenCount += sentenceTokenCount;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
};

module.exports = {
  extractTextFromPDF,
  chunkText,
};

