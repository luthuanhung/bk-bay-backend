// Load environment variables from .env (same as the app uses)
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const pool = require('../src/config/database');
const sql = require('mssql');
const bcrypt = require('bcryptjs');

// Usage:
// node scripts/hashUserPassword.js <identifier> <plaintextPassword>
// identifier: email (contains '@') or user id (e.g. B-001) or username

async function run() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node scripts/hashUserPassword.js <identifier> <plaintextPassword>');
    process.exit(1);
  }

  const [identifier, plaintext] = args;
  const isEmail = identifier.includes('@');
  const isId = /^B-|^U-|^[A-Z]-|^[0-9]+$/i.test(identifier); // heuristic

  try {
    await pool.connect();
    console.log('Connected to DB');

    const hashed = await bcrypt.hash(plaintext, 10);

    const req = pool.request();
    req.input('password', sql.VarChar, hashed);

    let query;
    if (isEmail) {
      req.input('email', sql.VarChar, identifier);
      query = `UPDATE [User] SET Password = @password WHERE Email = @email`;
    } else if (isId) {
      req.input('id', sql.VarChar, identifier);
      query = `UPDATE [User] SET Password = @password WHERE Id = @id`;
    } else {
      req.input('username', sql.VarChar, identifier);
      query = `UPDATE [User] SET Password = @password WHERE Username = @username`;
    }

    const result = await req.query(query);
    console.log('Rows affected:', result.rowsAffected);
    if (result.rowsAffected && result.rowsAffected[0] > 0) {
      console.log('Password updated and hashed successfully for', identifier);
      process.exit(0);
    } else {
      console.error('No rows updated. Check that the identifier exists and try again.');
      process.exit(2);
    }
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(3);
  } finally {
    try { await pool.close(); } catch (e) { }
  }
}

run();
