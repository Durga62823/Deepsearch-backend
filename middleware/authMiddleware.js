// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
// dotenv.config(); // REMOVE THIS LINE if present here, it should only be in server.js

module.exports = (req, res, next) => {
    const token = req.header('x-auth-token');
    console.log("Received token:", token); // Debug log

    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded.user;
        next();
    } catch (err) {
        console.error('Token verification failed:', err.message); // Debug log

        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ msg: 'Token expired, please log in again' });
        }
        res.status(401).json({ msg: 'Token is not valid' });
    }
};