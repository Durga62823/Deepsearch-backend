const cloudinary = require('cloudinary').v2;
const dotenv = require('dotenv');

dotenv.config(); 
console.log('Cloudinary Config Debug:');
console.log('CLOUD_NAME:', process.env.CLOUD_NAME ? 'Loaded' : 'MISSING/EMPTY');
console.log('API_KEY:', process.env.API_KEY ? 'Loaded' : 'MISSING/EMPTY');
console.log('API_SECRET:', process.env.API_SECRET ? 'Loaded' : 'MISSING/EMPTY');
console.log('---------------------------------');
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
  secure: true
});

module.exports = cloudinary;
