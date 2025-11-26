const pool = require('../config/database');
const sql = require('mssql');
const { generateId } = require('../utils/userUtils');

async function listProductsBySeller(sellerId, opts = {}) {
  // Accept either `orderBy` or `sortBy` from the caller
  const { limit = 20, offset = 0, search, minPrice, maxPrice, size, color, order = 'DESC' } = opts;
  const { category, stock: stockFilter, hasImages } = opts;
  const orderBy = opts.orderBy || opts.sortBy || 'BarCode';
  const request = pool.request();
  request.input('sellerId', sql.VarChar, sellerId);
  request.input('limit', sql.Int, limit);
  request.input('offset', sql.Int, offset);

  const where = ['p.sellerID = @sellerId'];
  if (search) { request.input('search', sql.VarChar, `%${search}%`); where.push("(p.[Name] LIKE @search OR p.Bar_code LIKE @search)"); }
  if (minPrice !== undefined) { request.input('minPrice', sql.Decimal(18,2), minPrice); where.push('Price >= @minPrice'); }
  if (maxPrice !== undefined) { request.input('maxPrice', sql.Decimal(18,2), maxPrice); where.push('Price <= @maxPrice'); }
  if (size) { request.input('size', sql.VarChar, size); where.push('Size = @size'); }
  if (color) { request.input('color', sql.VarChar, color); where.push('Color = @color'); }
  if (category) { request.input('category', sql.VarChar, category); where.push('EXISTS (SELECT 1 FROM Belongs_to b WHERE b.Barcode = p.Bar_code AND b.CategoryName = @category)'); }
  if (stockFilter) {
    if (stockFilter === 'in') {
      where.push('EXISTS (SELECT 1 FROM VARIATIONS v WHERE v.Bar_code = p.Bar_code AND v.STOCK > 0)');
    } else if (stockFilter === 'out') {
      // Consider product out-of-stock when either:
      // - there exists a variation with STOCK = 0 (single-zero variation), OR
      // - there are no variations with STOCK > 0 (all zero or none)
      where.push('(EXISTS (SELECT 1 FROM VARIATIONS v WHERE v.Bar_code = p.Bar_code AND (v.STOCK = 0 OR v.STOCK IS NULL)) OR NOT EXISTS (SELECT 1 FROM VARIATIONS v WHERE v.Bar_code = p.Bar_code AND v.STOCK > 0))');
    }
  }
  if (hasImages) {
    if (hasImages === 'with') where.push('EXISTS (SELECT 1 FROM IMAGES im WHERE im.Bar_code = p.Bar_code)');
    else if (hasImages === 'without') where.push('NOT EXISTS (SELECT 1 FROM IMAGES im WHERE im.Bar_code = p.Bar_code)');
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const columnMap = {
    BarCode: 'p.Bar_code',
    Name: 'p.[Name]',
    Manufacturing_date: 'p.Manufacturing_date',
    Expired_date: 'p.Expired_date'
  };

  const orderCol = columnMap[orderBy] || 'p.Bar_code';
  const dir = (order && order.toUpperCase() === 'ASC') ? 'ASC' : 'DESC';

  // Select and alias DB columns to stable JS property names (BarCode, Name, Manufacturing_date, Expired_date, Description, sellerID)
  // Include one image URL per product (top 1) if available using OUTER APPLY for efficiency
  const query = `SELECT p.Bar_code, p.[Name] AS Name, p.Manufacturing_date, p.Expired_date, p.Description, p.sellerID, i.IMAGE_URL
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
  const result = await request.query('SELECT Bar_code, [Name] AS Name, Manufacturing_date, Expired_date, Description, sellerID FROM Product_SKU WHERE Bar_code = @barCode AND sellerID = @sellerId');
  const product = result.recordset[0];
  if (!product) return null;

  // Fetch variations (if VARIATIONS table exists and contains rows)
  try {
    const vReq = pool.request();
    vReq.input('barCode', sql.VarChar, barCode);
    const vRes = await vReq.query('SELECT NAME, PRICE, STOCK FROM VARIATIONS WHERE Bar_code = @barCode');
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
    const barCode = data.Bar_code || generateId();

    const req = new sql.Request(transaction);
    req.input('barCode', sql.VarChar, barCode);
    req.input('name', sql.VarChar, data.Name || '');
    req.input('manufacturingDate', sql.Date, data.Manufacturing_date || null);
    req.input('expiredDate', sql.Date, data.Expired_date || null);
    req.input('description', sql.NVarChar, data.Description || null);
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

// Add variations to an existing product (creates a transaction internally)
async function addVariationsForProduct(sellerId, barCode, variations) {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const req = new sql.Request(transaction);
    req.input('barCode', sql.VarChar, barCode);
    req.input('sellerId', sql.VarChar, sellerId);

    // Verify product exists and belongs to this seller
    const check = await req.query('SELECT Bar_code FROM Product_SKU WHERE Bar_code = @barCode AND sellerID = @sellerId');
    if (!check.recordset || check.recordset.length === 0) {
      await transaction.rollback();
      return { success: false, reason: 'not_found' };
    }

    // Reuse existing persistVariations that expects a transaction
    await persistVariations(transaction, barCode, variations);

    await transaction.commit();
    return { success: true };
  } catch (err) {
    try { await transaction.rollback(); } catch (e) {}
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
      // Accept both DB-named fields (Name, Manufacturing_date, Expired_date, Description)
      // and legacy camelCase fields (name, manufacturingDate, expiredDate, description).
      if (data.Name !== undefined) { req.input('name', sql.VarChar, data.Name); sets.push('[Name] = @name'); }
      if (data.Manufacturing_date !== undefined) { req.input('manufacturingDate', sql.Date, data.Manufacturing_date); sets.push('Manufacturing_date = @manufacturingDate'); }
      if (data.Expired_date !== undefined) { req.input('expiredDate', sql.Date, data.Expired_date); sets.push('Expired_date = @expiredDate'); }
      if (data.Description !== undefined) { req.input('description', sql.NVarChar, data.Description); sets.push('Description = @description'); }

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
  const hasStock = await hasColumn(transaction, 'VARIATIONS', 'STOCK');

  // Build batch insert with parameters to avoid SQL injection
  const inserts = [];
  const req = new sql.Request(transaction);
  req.input('barCode', sql.VarChar, barCode);
  variations.forEach((v, idx) => {
    const n = `name${idx}`;
    const p = `price${idx}`;
    req.input(n, sql.VarChar, v.NAME || '');
    req.input(p, sql.Decimal(18,2), v.PRICE !== undefined ? v.PRICE : 0);
    if (hasStock) {
      const s = `stock${idx}`;
      req.input(s, sql.Int, v.STOCK !== undefined ? v.STOCK : 0);
      inserts.push(`(@barCode, @${n}, @${p}, @${s})`);
    } else {
      inserts.push(`(@barCode, @${n}, @${p})`);
    }
  });

  if (!inserts.length) return;

  const insertQuery = hasStock
    ? `INSERT INTO VARIATIONS (Bar_code, NAME, PRICE, STOCK) VALUES ${inserts.join(',')}`
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

module.exports = {
  listProductsBySeller,
  getProductByBarcode,
  createProduct,
  updateProduct,
  deleteProduct,
  addVariationsForProduct,
};
