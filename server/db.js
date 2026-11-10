'use strict';
// Postgres pool + migration runner.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  'postgres://mpa:mpa_dev@localhost:5433/mpa_league';

const pool = new Pool({ connectionString, max: 10 });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    const dir = path.join(__dirname, 'migrations');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [file]
      );
      if (rows.length) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      console.log(`[migrate] applied ${file}`);
    }
  } finally {
    client.release();
  }
}

module.exports = { pool, migrate };
