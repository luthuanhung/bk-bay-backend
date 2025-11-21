const mssql = require('mssql');
const config = process.env.SQLSERVER_URL;

//Create connection pool
const pool = new mssql.ConnectionPool(config);
module.exports = pool;