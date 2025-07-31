const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.signup = async (req, res) => {
    console.log('--- Register Controller Hit ---');
    console.log('Request Body:', req.body);

    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            console.log('Validation Error: Missing fields');
            return res.status(400).json({ message: 'Name, email, and password are required.' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log('Validation Error: User already exists');
            return res.status(409).json({ message: 'User with this email already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            name,
            email,
            password: hashedPassword,
        });

        await newUser.save();
        console.log('User saved successfully:', newUser.email);

        res.status(201).json({ message: 'User registered successfully.' });

    } catch (err) {
        console.error('Signup Error:', err);
        res.status(500).json({ message: 'Internal server error during signup.' });
    }
};

exports.login = async (req, res) => {
    console.log('--- Login Controller Hit ---');
    console.log('Request Body:', req.body);

    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const payload = {
            user: {
                id: user._id
            }
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({ token, user: { id: user._id, email: user.email, name: user.name } });

    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ message: 'Internal server error during login.' });
    }
};