const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const sql = require('mssql');
const { generateId } = require('../utils/userUtils');


async function getUserByEmail(email) {
    const request = pool.request();
    request.input('email', email);
    // FIX: Wrapped User in brackets to avoid SQL reserved keyword error
    const result = await request.query('SELECT * FROM [User] WHERE Email = @email'); 
    return result.recordset[0];
}

async function getUserByUsername(username) {
    const request = pool.request();
    request.input('username', username);
    // FIX: Wrapped User in brackets to avoid SQL reserved keyword error
    const result = await request.query('SELECT * FROM [User] WHERE Username = @username'); 
    return result.recordset[0];
}

async function getUserById(userId) {
    const request = pool.request();
    request.input('userId', userId);
    const result = await request.query('SELECT * FROM [User] WHERE Id = @userId');
    return result.recordset[0];
}

async function comparePassword(inputPassword, storedHashedPassword) {
    return await bcrypt.compare(inputPassword, storedHashedPassword);
}

async function checkRole(userId) {
    const request = pool.request();
    request.input('userId', userId);
    const result = await request.query(`
        SELECT 
            CASE
                WHEN EXISTS (SELECT 1 FROM Admin WHERE Id = @userId) THEN 'admin'
                WHEN EXISTS (SELECT 1 FROM Seller WHERE Id = @userId) THEN 'seller'
                WHEN EXISTS (SELECT 1 FROM Buyer WHERE Id = @userId) THEN 'buyer'
                WHEN EXISTS (SELECT 1 FROM Shipper WHERE Id = @userId) THEN 'shipper'
                ELSE 'unknown'
            END AS Role
    `);
    return result.recordset[0]?.Role || 'unknown';
}

const createUser = async (user) => {
    // 1. Create a transaction using the existing pool
    const transaction = new sql.Transaction(pool);

    try {
        // Start Transaction
        await transaction.begin();

        const userId = generateId();

        // 2. Insert into "User" Table
        const userRequest = new sql.Request(transaction);
        userRequest.input('id', sql.VarChar, userId);
        userRequest.input('username', sql.VarChar, user.username);
        userRequest.input('password', sql.VarChar, user.password);
        userRequest.input('email', sql.VarChar, user.email);
        userRequest.input('gender', sql.VarChar, user.gender);
        // FIX: Ensure age is safely converted to integer
        userRequest.input('age', sql.Int, parseInt(user.age, 10)); 
        userRequest.input('dateOfBirth', sql.Date, user.dateOfBirth);
        userRequest.input('address', sql.VarChar, user.address);
        userRequest.input('rank', sql.VarChar, 'Bronze'); // Default Rank

        // FIX: [User] is correctly bracketed here. [Rank] is also correctly bracketed.
        await userRequest.query(`
            INSERT INTO [User] (Id, Username, Password, Email, Gender, Age, DateOfBirth, Address, [Rank])
            VALUES (@id, @username, @password, @email, @gender, @age, @dateOfBirth, @address, @rank)
        `);

        // 3. Insert Phone Number (if provided)
        if (user.phoneNumber) {
            const phoneRequest = new sql.Request(transaction);
            phoneRequest.input('userId', sql.VarChar, userId);
            phoneRequest.input('phone', sql.VarChar, user.phoneNumber);
            
            await phoneRequest.query(`
                INSERT INTO UserPhoneNumber (UserId, PhoneNumber)
                VALUES (@userId, @phone)
            `);
        }

        // 4. Handle Roles (Buyer, Seller, Admin, Shipper)
        const roleLower = user.role ? user.role.toLowerCase() : 'buyer'; // Default to buyer if missing

        if (roleLower === 'buyer') {
            // Buyers need a Cart first
            const cartId = generateId(); 
            
            const cartRequest = new sql.Request(transaction);
            cartRequest.input('cartId', sql.VarChar, cartId);
            await cartRequest.query(`INSERT INTO Cart (Id) VALUES (@cartId)`);

            // Link User to Cart in Buyer table
            const buyerRequest = new sql.Request(transaction);
            buyerRequest.input('userId', sql.VarChar, userId);
            buyerRequest.input('cartId', sql.VarChar, cartId);
            await buyerRequest.query(`
                INSERT INTO Buyer (Id, cartId) VALUES (@userId, @cartId)
            `);
        } 
        else if (roleLower === 'seller') {
            const sellerRequest = new sql.Request(transaction);
            sellerRequest.input('userId', sql.VarChar, userId);
            await sellerRequest.query(`INSERT INTO Seller (Id) VALUES (@userId)`);
        }
        // else if (roleLower === 'admin') {
        //     const adminRequest = new sql.Request(transaction);
        //     adminRequest.input('userId', sql.VarChar, userId);
        //     await adminRequest.query(`INSERT INTO Admin (Id) VALUES (@userId)`);
        // }
        else if (roleLower === 'shipper') { 
            const shipperRequest = new sql.Request(transaction);
            shipperRequest.input('userId', sql.VarChar, userId);
            shipperRequest.input('LicensePlate', sql.VarChar, user.licensePlate || '');
            shipperRequest.input('Company', sql.VarChar, user.Company || '');
            await shipperRequest.query(`INSERT INTO Shipper (Id, LicensePlate, Company) VALUES (@userId, @LicensePlate, @Company)`);
        }

        // 5. Commit Transaction (Save everything)
        await transaction.commit();

        // Return the new user object
        return { 
            id: userId, 
            username: user.username, 
            email: user.email, 
            role: user.role,
            password: user.password, // Include for controller sanitization
            age: parseInt(user.age, 10),
            dateOfBirth: user.dateOfBirth,
            gender: user.gender,
            address: user.address,
            phoneNumber: user.phoneNumber,
        };

    } catch (error) {
        // If ANY step fails, undo everything
        await transaction.rollback();
        // Log the error within the model for better debugging
        console.error('MODEL USER CREATION ERROR (ROLLBACK):', error); 
        throw error;
    }
};

module.exports = {
    getUserByEmail,
    getUserByUsername,
    getUserById,
    comparePassword,
    checkRole,
    createUser
};