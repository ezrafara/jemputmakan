// Data demo. Studi kasus Kantin Bu Sari – Teknik memakai jarak dari laporan (Bab 4.2.1);
// merchant lain dan jaraknya adalah CONTOH DEMO, bukan hasil pengukuran.
import { openDb } from './db.js';
import { hashPassword } from './auth.js';
import { dateWIB, nowWIB } from './util.js';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

export const DEMO_PASSWORD = 'demo1234';
const KAT = ['Makanan Berat', 'Minuman', 'Snack'];

const MERCHANTS = [
  { email: 'busari@jemputmakan.test', nama: 'Kantin Bu Sari – Teknik', lokasi: 'Gedung Fakultas Teknik UB (contoh alamat, sesuaikan)', buka: '07:00', tutup: '16:30',
    desk: 'Kantin legendaris anak Teknik: nasi rames, ayam penyet, dan minuman dingin.', lat: -7.9526, lng: 112.6143,
    jarak: [['FILKOM UB', 0.95, 1.50, 'studi kasus laporan'], ['FK UB', 1.50, 1.30, 'studi kasus laporan'], ['FEB UB', 1.30, 0.90, 'studi kasus laporan']],
    menu: [[0, 'Nasi Ayam Penyet', 'Ayam penyet, sambal, lalapan', 15000], [0, 'Nasi Pecel Lele', 'Lele goreng, sambal terasi', 16000],
      [0, 'Nasi Soto Ayam', 'Soto ayam kuah bening', 13000], [0, 'Nasi Rames Telur', 'Nasi, telur, sayur, sambal', 12000],
      [0, 'Mie Goreng Telur', 'Mie goreng bumbu kampus', 11000], [1, 'Es Teh Manis', '', 4000], [1, 'Es Jeruk', '', 6000],
      [1, 'Kopi Susu', 'Kopi susu gula aren', 8000], [2, 'Pisang Goreng', '3 potong', 5000], [2, 'Tahu Crispy', 'Tahu goreng tepung', 6000]] },
  { email: 'kopitadah@jemputmakan.test', nama: 'Kopi Kampus Tadah', lokasi: 'Dekat Gerbang Barat UB (contoh alamat)', buka: '08:00', tutup: '21:00',
    desk: 'Kafe nyaman untuk nugas: kopi, roti, dan makan ringan.', lat: -7.9519, lng: 112.6128,
    jarak: [['FILKOM UB', 0.60, 0.70, 'contoh demo'], ['FK UB', 0.80, 0.85, 'contoh demo'], ['FEB UB', 0.40, 0.45, 'contoh demo']],
    menu: [[1, 'Kopi Susu Gula Aren', '', 15000], [1, 'Americano', '', 12000], [1, 'Matcha Latte', '', 18000], [1, 'Es Coklat', '', 16000],
      [0, 'Nasi Chicken Katsu', 'Katsu, saus, nasi', 22000], [0, 'Mie Goreng Spesial', '', 18000],
      [2, 'Croissant Butter', '', 14000], [2, 'Roti Bakar Coklat Keju', '', 13000], [2, 'Kentang Goreng', '', 14000]] },
  { email: 'yati@jemputmakan.test', nama: 'Warung Pecel Bu Yati', lokasi: 'Dekat FILKOM UB (contoh alamat)', buka: '06:30', tutup: '15:00',
    desk: 'Pecel dan rawon rumahan dengan harga mahasiswa.', lat: -7.9535, lng: 112.6147,
    jarak: [['FILKOM UB', 0.30, 0.35, 'contoh demo'], ['FK UB', 1.10, 1.20, 'contoh demo'], ['FEB UB', 0.90, 1.00, 'contoh demo']],
    menu: [[0, 'Nasi Pecel Komplit', 'Sayur, rempeyek, telur', 12000], [0, 'Nasi Pecel Tempe Tahu', '', 10000], [0, 'Rawon', 'Rawon daging dengan nasi', 17000],
      [1, 'Es Teh', '', 3500], [1, 'Wedang Jahe', '', 5000], [2, 'Rempeyek', '', 3000], [2, 'Tempe Mendoan', '3 potong', 5000]] },
  { email: 'dimas@jemputmakan.test', nama: 'Geprek Mas Dimas', lokasi: 'Dekat FK UB (contoh alamat)', buka: '10:00', tutup: '20:00',
    desk: 'Ayam geprek dengan level pedas sesuka hati.', lat: -7.9541, lng: 112.6159,
    jarak: [['FILKOM UB', 1.20, 1.40, 'contoh demo'], ['FK UB', 0.35, 0.40, 'contoh demo'], ['FEB UB', 0.95, 1.05, 'contoh demo']],
    menu: [[0, 'Ayam Geprek Original', '', 14000], [0, 'Ayam Geprek Keju', '', 18000], [0, 'Nasi Ayam Bakar', '', 16000],
      [1, 'Es Teh Jumbo', '', 5000], [1, 'Es Lemon Tea', '', 6000], [2, 'Tahu Walik', '', 7000], [2, 'Kentang Goreng', '', 8000]] },
  { email: 'pojokfeb@jemputmakan.test', nama: 'Pojok Snack FEB', lokasi: 'Dekat FEB UB (contoh alamat)', buka: '08:00', tutup: '17:00',
    desk: 'Es teh, thai tea, dan jajanan sore favorit.', lat: -7.9512, lng: 112.6119,
    jarak: [['FILKOM UB', 1.00, 1.10, 'contoh demo'], ['FK UB', 0.90, 1.00, 'contoh demo'], ['FEB UB', 0.25, 0.30, 'contoh demo']],
    menu: [[1, 'Es Teh Manis', '', 4000], [1, 'Es Lemon', '', 6000], [1, 'Thai Tea', '', 10000], [2, 'Cireng Isi', '5 buah', 8000],
      [2, 'Siomay Kuah', '', 10000], [2, 'Batagor', '', 12000], [0, 'Nasi Goreng Ayam', '', 14000]] },
];

export async function seed(db0) {
  await db0.tx(async (db) => {
    const hash = hashPassword(DEMO_PASSWORD);
    const ts = nowWIB();
    const addUser = async (nama, email, role) => (await db.get(
      'INSERT INTO "user" (nama, email, password_hash, role, created_at) VALUES (?,?,?,?,?) RETURNING id', [nama, email, hash, role, ts])).id;
    await addUser('Faradila Aurelia', 'faradila@student.ub.ac.id', 'MAHASISWA');
    await addUser('Ezra Fara', 'ezra@student.ub.ac.id', 'MAHASISWA');
    const catId = [];
    for (const n of KAT) catId.push((await db.get('INSERT INTO category (nama) VALUES (?) RETURNING id', [n])).id);
    for (const m of MERCHANTS) {
      const uid = await addUser(m.nama, m.email, 'MERCHANT');
      const mid = (await db.get(`INSERT INTO merchant (user_id, nama, deskripsi, lokasi, latitude, longitude, jam_buka, jam_tutup)
        VALUES (?,?,?,?,?,?,?,?) RETURNING id`, [uid, m.nama, m.desk, m.lokasi, m.lat, m.lng, m.buka, m.tutup])).id;
      for (const [t, a, b, src] of m.jarak)
        await db.run('INSERT INTO merchant_distance (merchant_id, titik_asal, jarak_motor_km, jarak_jalan_km, sumber) VALUES (?,?,?,?,?)', [mid, t, a, b, src]);
      for (const [k, nama, desk, harga] of m.menu)
        await db.run('INSERT INTO menu (merchant_id, category_id, nama, deskripsi, harga) VALUES (?,?,?,?,?)', [mid, catId[k], nama, desk, harga]);
    }
  });
  await ensureSlots(db0);
}

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

// Slot 30 menit untuk hari ini & besok sepanjang jam operasional. Idempotent dan aman bila dijalankan
// bersamaan oleh beberapa instance (UNIQUE merchant_id+waktu_mulai + ON CONFLICT DO NOTHING).
// Satu query pemeriksaan + INSERT multi-baris agar sedikit round-trip ke database jarak jauh.
export async function ensureSlots(db, days = [0, 1], kuota = 5) {
  const dayList = days.map((d) => dateWIB(d));
  const [ms, have] = await Promise.all([
    db.all('SELECT id, jam_buka, jam_tutup FROM merchant'),
    db.all('SELECT DISTINCT merchant_id, SUBSTR(waktu_mulai, 1, 10) AS d FROM pickup_slot WHERE waktu_mulai >= ?', [dayList[0]]),
  ]);
  const has = new Set(have.map((r) => `${r.merchant_id}|${r.d}`));
  const rows = [];
  for (const m of ms) for (const day of dayList) {
    if (has.has(`${m.id}|${day}`)) continue;
    for (let t = toMin(m.jam_buka); t + 30 <= toMin(m.jam_tutup); t += 30) rows.push([m.id, `${day}T${hhmm(t)}`, `${day}T${hhmm(t + 30)}`, kuota]);
  }
  for (let i = 0; i < rows.length; i += 100) { // chunk: batas jumlah parameter
    const chunk = rows.slice(i, i + 100);
    await db.run(`INSERT INTO pickup_slot (merchant_id, waktu_mulai, waktu_selesai, kuota) VALUES ${chunk.map(() => '(?,?,?,?)').join(',')} ON CONFLICT DO NOTHING`, chunk.flat());
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.env.DB_FILE || 'data/jemputmakan.db';
  if (!process.env.DATABASE_URL && process.argv.includes('--reset')) for (const s of ['', '-wal', '-shm']) rmSync(file + s, { force: true });
  const db = await openDb(file);
  if (process.env.DATABASE_URL && process.argv.includes('--reset')) {
    console.log('--reset di PostgreSQL dinonaktifkan demi keamanan. Kosongkan tabel lewat Supabase SQL Editor bila perlu.');
  }
  if ((await db.get('SELECT COUNT(*) AS n FROM "user"')).n > 0) console.log('Database sudah berisi data; seed dilewati.');
  else { await seed(db); console.log(`Seed selesai. Akun demo (password: ${DEMO_PASSWORD}): faradila@student.ub.ac.id, ezra@student.ub.ac.id, busari@jemputmakan.test (merchant)`); }
  await db.close();
}
