const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const generateToken = (userId, userRole) => {
    return jwt.sign(
        { id: userId, role: userRole },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );
}
const setCookies = (res, token) => {
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
}
const clearCookies = (res) => {
    const clearOptions = {
        expires: new Date(0),
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
    }
    res.cookie('token', '', clearOptions);
}
const generateId = () => {
    return crypto.randomBytes(16).toString('hex');
}
const sanitizeUser = (user) => {
    const { password, ...sanitizedUser } = user;
    return sanitizedUser;
}
const sanitizeLoginUser = (user) => {
    const { Password, ...sanitizedUser } = user;
    return sanitizedUser;
}

module.exports = {
    generateToken,
    setCookies,
    clearCookies,
    generateId,
    sanitizeUser,
    sanitizeLoginUser
};