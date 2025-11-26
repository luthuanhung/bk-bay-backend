require('dotenv').config({ quiet: true });
// load environment
const express = require('express'); // use express framework
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pool = require('./database'); // database connection

const userRoutes = require('../routes/userRoutes');

const reviewRoutes = require('../routes/reviewRoutes');
const productRoutes = require('../routes/productRoutes');
const sellerProductsRoutes = require('../routes/sellerProductsRoutes')
const orderRoutes = require('../routes/orderRoutes');


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

app.use('/api/reviews', reviewRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sellers', sellerProductsRoutes)
app.use('/api/orders', orderRoutes);

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