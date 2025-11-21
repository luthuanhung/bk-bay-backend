require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pool = require('./database');

const userRoutes = require('../routes/userRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

//Allow all CORS
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Middleware
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/users', userRoutes);

//404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found"
  })
})

// Start server
async function startServer() {
  try {
    await pool.connect();
    console.log('✅ Database connected successfully');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

startServer();