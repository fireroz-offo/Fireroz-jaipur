import fs from 'fs'; import { pool } from './db.js';
await pool.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
console.log('Migration complete'); await pool.end();
