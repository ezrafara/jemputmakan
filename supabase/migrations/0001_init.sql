-- JemputMakan: skema awal untuk Supabase/PostgreSQL. Dibuat otomatis oleh `npm run db:sql` dari db/schema.js; jangan diedit manual.

CREATE TABLE IF NOT EXISTS "user" (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, nama TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('MAHASISWA','MERCHANT')),
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS merchant (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  nama TEXT NOT NULL, deskripsi TEXT NOT NULL DEFAULT '', lokasi TEXT NOT NULL,
  latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, jam_buka TEXT NOT NULL DEFAULT '08:00', jam_tutup TEXT NOT NULL DEFAULT '16:00',
  is_open INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS merchant_distance (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, merchant_id INTEGER NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  titik_asal TEXT NOT NULL, jarak_motor_km DOUBLE PRECISION NOT NULL, jarak_jalan_km DOUBLE PRECISION NOT NULL,
  sumber TEXT NOT NULL DEFAULT 'contoh demo');
CREATE TABLE IF NOT EXISTS category (id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, nama TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS menu (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, merchant_id INTEGER NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES category(id), nama TEXT NOT NULL, deskripsi TEXT NOT NULL DEFAULT '',
  harga INTEGER NOT NULL CHECK (harga >= 0), is_available INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS pickup_slot (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, merchant_id INTEGER NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  waktu_mulai TEXT NOT NULL, waktu_selesai TEXT NOT NULL,
  kuota INTEGER NOT NULL CHECK (kuota >= 1), terpakai INTEGER NOT NULL DEFAULT 0,
  UNIQUE (merchant_id, waktu_mulai));
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES "user"(id), merchant_id INTEGER NOT NULL REFERENCES merchant(id),
  pickup_slot_id INTEGER NOT NULL REFERENCES pickup_slot(id), pickup_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL, total_bayar INTEGER NOT NULL, catatan TEXT NOT NULL DEFAULT '',
  titik_asal TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_detail (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_id INTEGER REFERENCES menu(id) ON DELETE SET NULL,
  nama_menu_snapshot TEXT NOT NULL, harga_snapshot INTEGER NOT NULL, jumlah INTEGER NOT NULL CHECK (jumlah >= 1));
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  cart TEXT NOT NULL DEFAULT '{}', expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempt (
  attempt_key TEXT PRIMARY KEY, fails INTEGER NOT NULL, first_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_menu_merchant ON menu(merchant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_slot_merchant_waktu ON pickup_slot(merchant_id, waktu_mulai);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_status ON orders(merchant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_slot ON orders(pickup_slot_id);
CREATE INDEX IF NOT EXISTS idx_detail_order ON order_detail(order_id);
CREATE INDEX IF NOT EXISTS idx_dist_merchant ON merchant_distance(merchant_id);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);

ALTER TABLE public."user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."merchant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."merchant_distance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."menu" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pickup_slot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."order_detail" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."login_attempt" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
  END IF;
END $$;
