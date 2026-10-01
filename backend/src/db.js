import mysql from "mysql2/promise";

const {
  DB_HOST = "localhost",
  DB_PORT = "3306",
  DB_USER = "root",
  DB_PASS = "",
  DB_NAME = "appdb",
} = process.env;

let pool;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: DB_HOST,
      port: Number(DB_PORT),
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      charset: 'utf8mb4_unicode_ci',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true,
    });
  }
  return pool;
}

export async function ping() {
  const p = getPool();
  const [rows] = await p.query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
