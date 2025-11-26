const productModel = require('../models/Product');
const userModel = require('../models/User');

// Strict validation + mapping for product payloads.
// API expects the exact field names (no fuzzy matching):
// - Bar_code (string) required for create
// - Name (string) required for create
// - Description (string) optional
// - Manufacturing_date (ISO date string) optional
// - Expired_date (ISO date string) optional
// - variations: array of { NAME: string, PRICE: number, STOCK?: number } optional
// - category: string optional
// This function validates and maps API fields to the model's camelCase fields.
function validateAndMapProductPayload(data, { forUpdate = false } = {}) {
  if (!data || typeof data !== 'object') return { error: 'Invalid payload', fieldErrors: { _payload: 'Expected JSON object' } };

  const fieldErrors = {};
  const out = {};

  // For create, require explicit Bar_code and Name
  if (!forUpdate) {
    if (!data.Bar_code || typeof data.Bar_code !== 'string') fieldErrors.Bar_code = 'Bar_code (string) is required';
    if (!data.Name || typeof data.Name !== 'string') fieldErrors.Name = 'Name (string) is required';
  }

  // Optional fields (must use exact names if present)
  if (data.Description !== undefined) {
    if (typeof data.Description !== 'string') fieldErrors.Description = 'Description must be a string';
    else out.Description = data.Description;
  }
  if (data.Manufacturing_date !== undefined) {
    out.Manufacturing_date = data.Manufacturing_date || null;
  }
  if (data.Expired_date !== undefined) {
    out.Expired_date = data.Expired_date || null;
  }

  // Variations: if present must be array of objects with NAME and PRICE
  if (data.variations !== undefined) {
    if (!Array.isArray(data.variations)) {
      fieldErrors.variations = 'Variations must be an array';
    } else {
      const vErrs = [];
      data.variations.forEach((v, i) => {
        const ve = {};
        if (!v || typeof v !== 'object') { vErrs[i] = { _error: 'Empty or invalid variant' }; return; }
        if (!v.NAME || typeof v.NAME !== 'string') ve.NAME = 'Variant.NAME (string) required';
        if (v.PRICE === undefined || v.PRICE === null || isNaN(Number(v.PRICE))) ve.PRICE = 'Variant.PRICE must be a number';
          if (v.STOCK !== undefined && isNaN(Number(v.STOCK))) ve.STOCK = 'Variant.STOCK must be a number when provided';
        if (Object.keys(ve).length) vErrs[i] = ve;
      });
      if (vErrs.length && vErrs.some(Boolean)) fieldErrors.variations = vErrs;
      else out.variations = data.variations.map(v => ({ NAME: v.NAME, PRICE: Number(v.PRICE), STOCK: v.STOCK !== undefined ? Number(v.STOCK) : undefined }));
    }
  }

  if (data.category !== undefined) {
    if (typeof data.category !== 'string') fieldErrors.category = 'Category must be a string';
    else out.category = data.category;
  }

  // Images: optional array of image URL strings
  if (data.images !== undefined) {
    if (!Array.isArray(data.images)) {
      fieldErrors.images = 'Images must be an array of URL strings';
    } else {
      const iErrs = [];
      data.images.forEach((u, i) => {
        if (typeof u !== 'string') iErrs[i] = 'Image URL must be a string';
      });
      if (iErrs.length && iErrs.some(Boolean)) fieldErrors.images = iErrs;
      else out.images = data.images;
    }
  }
  
  // Map Bar_code and Name explicitly when present
  if (data.Bar_code !== undefined) out.Bar_code = data.Bar_code;
  if (data.Name !== undefined) out.Name = data.Name;

  if (Object.keys(fieldErrors).length) return { fieldErrors };
  return { data: out };
}

const listProducts = async (req, res) => {
  try {
    const sellerId = req.user?.Id;
    const role = await userModel.checkRole(sellerId);
    if (role !== 'seller' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { limit, offset, search, status, sortBy, order } = req.query;
    const result = await productModel.listProductsBySeller(sellerId, {
      limit: parseInt(limit, 10) || 20,
      offset: parseInt(offset, 10) || 0,
      search,
      status,
      sortBy,
      order,
    });

    res.status(200).json({ success: true, products: result });
  } catch (err) {
    console.error('sellerProductsController.listProducts error:', err);
    res.status(500).json({ success: false, message: 'Failed to list products', error: err.message });
  }
};

const getProduct = async (req, res) => {
  try {
    const sellerId = req.user?.Id;
    const role = await userModel.checkRole(sellerId);
    if (role !== 'seller' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const productId = req.params.id;
    const product = await productModel.getProductByBarcode(sellerId, productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.status(200).json({ success: true, product });
  } catch (err) {
    console.error('sellerProductsController.getProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to get product', error: err.message });
  }
};

const createProduct = async (req, res) => {
  try {
    const sellerId = req.user?.Id;
    const role = await userModel.checkRole(sellerId);
    if (role !== 'seller' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const incoming = req.body || {};
    // Strict validation and mapping for create API
    const { data, fieldErrors, error } = validateAndMapProductPayload(incoming, { forUpdate: false });
    if (error) return res.status(400).json({ success: false, message: error });
    if (fieldErrors) return res.status(400).json({ success: false, message: 'Validation failed', fieldErrors });

    const created = await productModel.createProduct(sellerId, data);
    res.status(201).json({ success: true, product: created });
  } catch (err) {
    console.error('sellerProductsController.createProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to create product', error: err.message });
  }
};

const insertVariations = async (req, res) => {
  try {
    const sellerId = req.user?.Id;
    const role = await userModel.checkRole(sellerId);
    if (role !== 'seller' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const productId = req.params.id;
    // Expect body to be either { variations: [...] } or an array directly
    const incoming = req.body;
    const variations = Array.isArray(incoming) ? incoming : incoming?.variations;

    if (!Array.isArray(variations) || variations.length === 0) {
      return res.status(400).json({ success: false, message: 'Validation failed', fieldErrors: { variations: 'Variations array required' }});
    }

    // Basic validation here (optional - you already have model validation in validateAndMapProductPayload)
    const vErrs = [];
    variations.forEach((v, i) => {
      const ve = {};
      if (!v || typeof v !== 'object') { ve._error = 'Invalid variant'; vErrs[i] = ve; return; }
      if (!v.NAME) ve.NAME = 'Variant.NAME required';
      if (v.PRICE === undefined || v.PRICE === null || isNaN(Number(v.PRICE))) ve.PRICE = 'Variant.PRICE must be a number';
      if (v.STOCK !== undefined && isNaN(Number(v.STOCK))) ve.STOCK = 'Variant.STOCK must be a number';
      if (Object.keys(ve).length) vErrs[i] = ve;
    });
    if (vErrs.length && vErrs.some(Boolean)) {
      return res.status(400).json({ success: false, message: 'Validation failed', fieldErrors: { variations: vErrs }});
    }

    // Normalize to expected variation objects with NAME and PRICE
    const normalized = variations.map(v => ({ NAME: v.NAME, PRICE: Number(v.PRICE), STOCK: v.STOCK !== undefined ? Number(v.STOCK) : undefined }));

    const result = await productModel.addVariationsForProduct(sellerId, productId, normalized);
    if (!result) {
      return res.status(500).json({ success: false, message: 'Failed to add variations' });
    }
    if (result.success === false && result.reason === 'not_found') {
      return res.status(404).json({ success: false, message: 'Product not found or not owned by seller' });
    }

    // Return the updated product
    const product = await productModel.getProductByBarcode(sellerId, productId);
    return res.status(200).json({ success: true, product });
  } catch (err) {
    console.error('sellerProductsController.insertVariations error:', err);
    return res.status(500).json({ success: false, message: 'Failed to insert variations', error: err.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const sellerId = req.user?.Id;
    const role = await userModel.checkRole(sellerId);
    if (role !== 'seller' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const productId = req.params.id;
    const incoming = req.body || {};
    // Strictly validate incoming payload and map to model fields
    const { data, fieldErrors, error } = validateAndMapProductPayload(incoming, { forUpdate: true });
    if (error) return res.status(400).json({ success: false, message: error });
    if (fieldErrors) return res.status(400).json({ success: false, message: 'Validation failed', fieldErrors });

    const updated = await productModel.updateProduct(sellerId, productId, data);
    if (!updated) return res.status(404).json({ success: false, message: 'Product not found or not owned by seller' });
    res.status(200).json({ success: true, product: updated });
  } catch (err) {
    if (err.message && err.message.includes('CONFLICT')) {
      return res.status(409).json({ success: false, message: 'Version conflict', error: err.message });
    }
    console.error('sellerProductsController.updateProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to update product', error: err.message });
  }
};

const patchProduct = async (req, res) => {
  // For partial updates, reuse updateProduct logic
  return updateProduct(req, res);
};

const deleteProduct = async (req, res) => {
  try {
    const sellerId = req.user?.Id;
    const role = await userModel.checkRole(sellerId);
    if (role !== 'seller' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const productId = req.params.id;
    const deleted = await productModel.deleteProduct(sellerId, productId);
    if (!deleted) return res.status(404).json({ success: false, message: 'Product not found or not owned by seller' });
    res.status(200).json({ success: true, message: 'Product deleted' });
  } catch (err) {
    console.error('sellerProductsController.deleteProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product', error: err.message });
  }
};

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  patchProduct,
  deleteProduct,
  insertVariations,
};
