const pool = require('../config/database');
const sql = require('mssql');
const { generateId } = require('../utils/userUtils');

// This model targets the Product_SKU table (see SQLTestCart.sql)
// Schema used in your DB:
// Bar_code (PK), Name, Manufacturing_date, Expired_date, Description, sellerID

async function listProductsBySeller(sellerId, opts = {}) {
  // Accept either `orderBy` or `sortBy` from the caller
  const { limit = 20, offset = 0, search, minPrice, maxPrice, size, color, order = 'DESC' } = opts;
  const orderBy = opts.orderBy || opts.sortBy || 'BarCode';
  const request = pool.request();
  request.input('sellerId', sql.VarChar, sellerId);
  request.input('limit', sql.Int, limit);
  request.input('offset', sql.Int, offset);

  const where = ['sellerID = @sellerId'];
  if (search) { request.input('search', sql.VarChar, `%${search}%`); where.push('(Name LIKE @search OR BarCode LIKE @search)'); }
  if (minPrice !== undefined) { request.input('minPrice', sql.Decimal(18,2), minPrice); where.push('Price >= @minPrice'); }
  if (maxPrice !== undefined) { request.input('maxPrice', sql.Decimal(18,2), maxPrice); where.push('Price <= @maxPrice'); }
  if (size) { request.input('size', sql.VarChar, size); where.push('Size = @size'); }
  if (color) { request.input('color', sql.VarChar, color); where.push('Color = @color'); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  // Map friendly sort names to actual DB columns (avoid invalid column names)
  const columnMap = {
    BarCode: 'Bar_code',
    Name: '[Name]',
    Manufacturing_date: 'Manufacturing_date',
    Manufacture_Date: 'Manufacturing_date',
    ManufactureDate: 'Manufacturing_date',
    Expired_date: 'Expired_date'
  };

  const orderCol = columnMap[orderBy] || 'Bar_code';
  const dir = (order && order.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

  // Select and alias DB columns to stable JS property names (BarCode, Name, Manufacturing_date, Expired_date, Description, sellerID)
  // Include one image URL per product (top 1) if available using OUTER APPLY for efficiency
  const query = `SELECT p.Bar_code AS BarCode, p.[Name] AS Name, p.Manufacturing_date AS Manufacturing_date, p.Expired_date AS Expired_date, p.Description AS Description, p.sellerID AS sellerID, i.IMAGE_URL AS IMAGE_URL
  FROM Product_SKU p
  OUTER APPLY (SELECT TOP 1 IMAGE_URL FROM IMAGES WHERE Bar_code = p.Bar_code) i
  ${whereClause} ORDER BY ${orderCol} ${dir} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
  // Dev log to help debug schema mismatches
  if (process.env.NODE_ENV !== 'production') {
    console.debug('listProductsBySeller query:', query, { sellerId, limit, offset, search, minPrice, maxPrice, size, color, orderBy, order });
  }

  const result = await request.query(query);
  return result.recordset || [];
}

async function getProductByBarcode(sellerId, barCode) {
  const request = pool.request();
  request.input('barCode', sql.VarChar, barCode);
  request.input('sellerId', sql.VarChar, sellerId);
  const result = await request.query('SELECT Bar_code AS BarCode, [Name] AS Name, Manufacturing_date AS Manufacturing_date, Expired_date AS Expired_date, Description AS Description, sellerID AS sellerID FROM Product_SKU WHERE Bar_code = @barCode AND sellerID = @sellerId');
  const product = result.recordset[0];
  if (!product) return null;

  // Fetch variations (if VARIATIONS table exists and contains rows)
  try {
    const vReq = pool.request();
    vReq.input('barCode', sql.VarChar, barCode);
    const vRes = await vReq.query('SELECT NAME AS name, PRICE AS price, Stock AS stock FROM VARIATIONS WHERE Bar_code = @barCode');
    product.variations = vRes.recordset || [];
  } catch (e) {
    // Variations table or Stock column may not exist in some schemas — fail gracefully
    product.variations = [];
  }

  // Fetch category (Belongs_to may contain multiple categories; return first or null)
  try {
    const cReq = pool.request();
    cReq.input('barCode', sql.VarChar, barCode);
    const cRes = await cReq.query('SELECT CategoryName FROM Belongs_to WHERE Barcode = @barCode');
    product.category = (cRes.recordset && cRes.recordset[0]) ? cRes.recordset[0].CategoryName : null;
  } catch (e) {
    product.category = null;
  }

  // Fetch images from IMAGES table
  try {
    const iReq = pool.request();
    iReq.input('barCode', sql.VarChar, barCode);
    const iRes = await iReq.query('SELECT IMAGE_URL AS url FROM IMAGES WHERE Bar_code = @barCode');
    product.images = (iRes.recordset || []).map(r => r.url);
  } catch (e) {
    product.images = [];
  }

  return product;
}

async function createProduct(sellerId, data) {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const barCode = data.barCode || data.BarCode || generateId();

    const req = new sql.Request(transaction);
    req.input('barCode', sql.VarChar, barCode);
    req.input('name', sql.VarChar, data.name || data.Name || '');
    req.input('manufacturingDate', sql.Date, data.manufacturingDate || data.Manufacturing_date || null);
    req.input('expiredDate', sql.Date, data.expiredDate || data.Expired_date || null);
    req.input('description', sql.NVarChar, data.description || data.Description || null);
    req.input('sellerId', sql.VarChar, sellerId);

    await req.query(`
      INSERT INTO Product_SKU (Bar_code, [Name], Manufacturing_date, Expired_date, Description, sellerID)
      VALUES (@barCode, @name, @manufacturingDate, @expiredDate, @description, @sellerId)
    `);

    // Persist variations (if provided)
    if (Array.isArray(data.variations) && data.variations.length) {
      await persistVariations(transaction, barCode, data.variations);
    }

    // Persist category relationship (Belongs_to)
    if (data.category) {
      await upsertBelongsTo(transaction, barCode, data.category);
    }

    await transaction.commit();
    return await getProductByBarcode(sellerId, barCode);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function updateProduct(sellerId, barCode, data) {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const req = new sql.Request(transaction);
    req.input('barCode', sql.VarChar, barCode);
    req.input('sellerId', sql.VarChar, sellerId);

    const sets = [];
    if (data.name !== undefined) { req.input('name', sql.VarChar, data.name); sets.push('[Name] = @name'); }
    if (data.manufacturingDate !== undefined) { req.input('manufacturingDate', sql.Date, data.manufacturingDate); sets.push('Manufacturing_date = @manufacturingDate'); }
    if (data.expiredDate !== undefined) { req.input('expiredDate', sql.Date, data.expiredDate); sets.push('Expired_date = @expiredDate'); }
    if (data.description !== undefined) { req.input('description', sql.NVarChar, data.description); sets.push('Description = @description'); }

    if (!sets.length) {
      await transaction.rollback();
      return await getProductByBarcode(sellerId, barCode);
    }

    const setClause = sets.join(', ');
    const updateQuery = `UPDATE Product_SKU SET ${setClause} WHERE Bar_code = @barCode AND sellerID = @sellerId`;
    const result = await req.query(updateQuery);

    // Persist variations if provided: overwrite existing variants for this barcode
    if (Array.isArray(data.variations)) {
      // remove existing for this barcode and insert new set
      await persistVariations(transaction, barCode, data.variations);
    }

    // Update category mapping if provided (null means remove)
    if (data.category !== undefined) {
      if (data.category === null) {
        const delReq = new sql.Request(transaction);
        delReq.input('barCode', sql.VarChar, barCode);
        await delReq.query('DELETE FROM Belongs_to WHERE Barcode = @barCode');
      } else {
        await upsertBelongsTo(transaction, barCode, data.category);
      }
    }

    await transaction.commit();

    const affected = result.rowsAffected ? result.rowsAffected.reduce((a,b)=>a+b,0) : 0;
    if (affected === 0) return null;
    return await getProductByBarcode(sellerId, barCode);
  } catch (err) {
    try { await transaction.rollback(); } catch (e) {}
    throw err;
  }
}

// Helper: check if a table has a column (uses current DB schema via INFORMATION_SCHEMA)
async function hasColumn(transactionOrPool, tableName, columnName) {
  const req = (transactionOrPool.request) ? transactionOrPool.request() : pool.request();
  req.input('table', sql.VarChar, tableName);
  req.input('column', sql.VarChar, columnName);
  const q = `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table AND COLUMN_NAME = @column`;
  const r = await req.query(q);
  return (r.recordset && r.recordset[0] && r.recordset[0].cnt > 0);
}

// Persist variations for a product inside a transaction. Strategy:
// - If VARIATIONS table exists: delete existing rows for the barcode and batch-insert provided variations.
// - Detect whether 'Stock' column exists and include it if available.
async function persistVariations(transaction, barCode, variations) {
  // Defensive: ensure variations is an array of objects with at least NAME and PRICE
  if (!Array.isArray(variations) || !variations.length) return;

  // Check if VARIATIONS table appears to exist
  try {
    const tableCheck = await hasColumn(transaction, 'VARIATIONS', 'NAME');
    if (!tableCheck) return; // nothing to do if table missing
  } catch (e) {
    // If schema introspection fails, bail out to avoid breaking product create/update
    return;
  }

  // Delete existing rows for this barcode
  const delReq = new sql.Request(transaction);
  delReq.input('barCode', sql.VarChar, barCode);
  await delReq.query('DELETE FROM VARIATIONS WHERE Bar_code = @barCode');

  // Determine if 'Stock' column exists
  const hasStock = await hasColumn(transaction, 'VARIATIONS', 'Stock');

  // Build batch insert with parameters to avoid SQL injection
  const inserts = [];
  const req = new sql.Request(transaction);
  req.input('barCode', sql.VarChar, barCode);
  variations.forEach((v, idx) => {
    const n = `name${idx}`;
    const p = `price${idx}`;
    req.input(n, sql.VarChar, v.NAME || v.name || '');
    req.input(p, sql.Decimal(18,2), v.PRICE !== undefined ? v.PRICE : (v.price !== undefined ? v.price : 0));
    if (hasStock) {
      const s = `stock${idx}`;
      req.input(s, sql.Int, v.Stock !== undefined ? v.Stock : (v.stock !== undefined ? v.stock : 0));
      inserts.push(`(@barCode, @${n}, @${p}, @${s})`);
    } else {
      inserts.push(`(@barCode, @${n}, @${p})`);
    }
  });

  if (!inserts.length) return;

  const insertQuery = hasStock
    ? `INSERT INTO VARIATIONS (Bar_code, NAME, PRICE, Stock) VALUES ${inserts.join(',')}`
    : `INSERT INTO VARIATIONS (Bar_code, NAME, PRICE) VALUES ${inserts.join(',')}`;

  await req.query(insertQuery);
}

// Upsert category relation in Belongs_to: remove existing Barcode entries and insert new one
async function upsertBelongsTo(transaction, barCode, category) {
  if (!category) return;
  const req = new sql.Request(transaction);
  req.input('barCode', sql.VarChar, barCode);
  req.input('category', sql.VarChar, category);
  // Delete any existing mappings for this barcode
  await req.query('DELETE FROM Belongs_to WHERE Barcode = @barCode');
  // Insert new mapping
  await req.query('INSERT INTO Belongs_to (CategoryName, Barcode) VALUES (@category, @barCode)');
}

async function deleteProduct(sellerId, barCode) {
  const request = pool.request();
  request.input('barCode', sql.VarChar, barCode);
  request.input('sellerId', sql.VarChar, sellerId);
  const result = await request.query('DELETE FROM Product_SKU WHERE Bar_code = @barCode AND sellerID = @sellerId');
  const affected = result.rowsAffected ? result.rowsAffected.reduce((a,b)=>a+b,0) : 0;
  return affected > 0;
}

/**
 * Get products by name substring.
 * Input: name (string)
 */
async function getProductByName(name) {
    if (!name) return [];

    const request = pool.request();
    // include wildcards in parameter value to use parameterized LIKE safely
    request.input('name', sql.VarChar(100), `%${name}%`);

    const query = `
        SELECT 
            p.Bar_code AS barcode,
            p.Name AS productName,
            p.AvgRating,
            (SELECT TOP 1 v.PRICE FROM VARIATIONS v WHERE v.Bar_code = p.Bar_code ORDER BY v.PRICE ASC) AS price,
            (SELECT TOP 1 i.IMAGE_URL FROM IMAGES i WHERE i.Bar_code = p.Bar_code) AS image
        FROM Product_SKU p
        WHERE p.Name LIKE @name
    `;

    const result = await request.query(query);
    return result.recordset;
}

async function getAllProduct() {
    const request = pool.request();

    const query = `
        SELECT 
            p.Bar_code AS barcode,
            p.Name AS productName,
            p.AvgRating,
            (SELECT TOP 1 v.PRICE FROM VARIATIONS v WHERE v.Bar_code = p.Bar_code ORDER BY v.PRICE ASC) AS price,
            (SELECT TOP 1 i.IMAGE_URL FROM IMAGES i WHERE i.Bar_code = p.Bar_code) AS image
        FROM Product_SKU p
    `;

    const result = await request.query(query);
    return result.recordset;
}

/**
 * Get all category names
 * Returns: [ "Category1", "Category2", ... ]
 */
async function getCategories() {
    const request = pool.request();
    const result = await request.query('SELECT Name FROM Category');
    return result.recordset.map(r => r.Name);
}
/*
 * Get full product details by barcode.
 */
async function getProductDetails(barcode) {
    const request = pool.request();
    request.input('barcode', sql.VarChar(100), barcode);

    try {
        const result = await request.execute('sp_GetProductDetails');
        return result.recordsets;
    } catch (err) {
        // Error message
        throw new Error(`Stored procedure 'sp_GetProductDetails' failed. Original error: ${err.message}`);
    }
}

/*
 * Get products by category name.
 * Input: category (string)
 */
async function getProductByCategory(category) {
  if (!category) return [];

  const request = pool.request();
  request.input('category', sql.VarChar(100), category);

  const query = `
    SELECT 
      p.Bar_code AS barcode,
      p.Name AS productName,
      p.AvgRating,
      (SELECT TOP 1 v.PRICE FROM VARIATIONS v WHERE v.Bar_code = p.Bar_code) AS price,
      (SELECT TOP 1 i.IMAGE_URL FROM IMAGES i WHERE i.Bar_code = p.Bar_code) AS image
    FROM Product_SKU p
    INNER JOIN Belongs_to b ON p.Bar_code = b.Barcode
    WHERE b.CategoryName = @category
  `;

  const result = await request.query(query);
  return result.recordset || [];
}

module.exports = {
  listProductsBySeller,
  // input sellerID, barcode
  // returns product details, images, variations, category
  getProductByBarcode,

  createProduct,
  updateProduct,
  deleteProduct,

  /*
     New methods
  */
  getProductByName, // returns products basic info
  getProductByCategory, // returns products basic info
  getAllProduct, // returns all products basic info
  getCategories, // returns list of category names
  // input barcode
  // returns product details, images, variations, category
  getProductDetails,
};
