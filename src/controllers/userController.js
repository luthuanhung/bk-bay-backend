const jwt = require('jsonwebtoken');
const userUtils = require('../utils/userUtils');
const userModel = require('../models/User');
const bcrypt = require('bcryptjs');


//@desc Get Current User
//@route GET /api/users/me
//@access Private
const getCurrentUser = async (req, res) => {
    try {
        const token = req.cookies.token
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided. Please log in.'
            });
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const userId = decoded.id;
            const user = await userModel.getUserById(userId);
            if (!user) {
                return res.status(404).json({ 
                    success: false,
                    message: 'User not found',
                });
            }
            const sanitizedUser = userUtils.sanitizeLoginUser(user);
            res.status(200).json({
                success: true,
                user: sanitizedUser,
                userRole: decoded.role
            });
        } catch (error) {
            userUtils.clearCookies(res);
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token. Please log in again.'
            });
        }

    } catch (err) {
        res.status(500).json({ 
            message: 'Failed to retrieve user',
            error: err.message
        });
    }
}


//@desc   Register a new user
//@route  POST /api/users/register
//@access Public
const registerUser = async (req, res) => {
    try {
        const {
            username,
            password,
            email,
            age,
            dateOfBirth,
            phoneNumber,
            address,
            gender,
            role
        } = req.body;
    
        //Check if user already exists
        const existingUser = await userModel.getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
    
        //Check username
        const existingUsername = await userModel.getUserByUsername(username);
        if (existingUsername) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        //Hashed password
        const hashedPassword = await bcrypt.hash(password, 10);
    
        //Create new user
        const userId = userUtils.generateId();
        const user = await userModel.createUser({
            id: userId,
            gender: gender,
            username: username,
            password: hashedPassword,
            email: email,
            age: age,
            dateOfBirth: dateOfBirth,
            phoneNumber: phoneNumber,
            address: address,
            role: role || 'buyer'
        });
        const sanitizedUser = userUtils.sanitizeUser(user);
    
        //Generate token and set cookies
        const token = userUtils.generateToken(userId, role);
        userUtils.setCookies(res, token);
        
        //Respond with success
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            user: sanitizedUser
        });
    } catch (err) {
        res.status(500).json({ 
            message: 'Registration failed', 
            error: err.message
        });
    }
}

//@desc  Login user
//@route POST /api/users/login
//@access Public
const loginUser = async (req, res) => {
    try {
        const { email, password, identifier } = req.body;
        //Support old format email and new format (identifier)
        const loginIdentifer = identifier || email;

        if (!loginIdentifer || !password) {
            return res.status(400).json({ error: 'Please provide email/username and password' });
        }

        let user;

        //Determine if identifier is email or username
        if (loginIdentifer.includes('@')) {
            user = await userModel.getUserByEmail(loginIdentifer);
        } else {
            user = await userModel.getUserByUsername(loginIdentifer);
        }

        if (!user) {
            return res.status(401).json({ 
                success: false,
                message: 'Invalid email/username or password' 
            });
        }

        const role = await userModel.checkRole(user.Id);
        console.log('User role during login:', role);
        if (role === 'banned') {
            return res.status(403).json({
                success: false,
                message: 'Your account has been banned. Please contact support.'
            });
        }

        //Compare password
        const isPasswordValid = await userModel.comparePassword(password, user.Password);
        if (!isPasswordValid) {
            return res.status(401).json({ 
                success: false,
                message: 'Invalid email/username or password' 
            });
        }

        //Generate token and set cookies
        const token = userUtils.generateToken(user.Id, role);
        userUtils.setCookies(res, token);

        res.status(200).json({
            success: true,
            message: 'Login successful',
            user: userUtils.sanitizeLoginUser(user)
        });
    } catch (err) {
        res.status(500).json({ 
            message: 'Login failed',
            error: err.message
        });
    }
}

module.exports = {
    getCurrentUser,
    registerUser,
    loginUser
};





