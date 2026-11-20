// Membuat file migrasi Supabase dari satu sumber skema (db/schema.js).
import { writeFileSync } from 'node:fs';
import { schemaSql } from '../db/schema.js';
const head = '-- JemputMakan: skema awal untuk Supabase/PostgreSQL. Dibuat otomatis oleh `npm run db:sql` dari db/schema.js; jangan diedit manual.\n';
writeFileSync(new URL('../supabase/migrations/0001_init.sql', import.meta.url), head + schemaSql('pg'));
console.log('supabase/migrations/0001_init.sql dibuat.');
