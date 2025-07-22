const { createServer } = require('http');
const app = require('../server');
export default function handler(req, res) {
    if (req.method === 'POST') {
      // handle login logic
      res.status(200).json({ message: "Logged in" });
    }
  }
  
module.exports = app;