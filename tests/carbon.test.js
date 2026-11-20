import test from 'node:test';
import assert from 'node:assert/strict';
import { emisiDelivery, emisiSelfPickup, deltaTransport, persenPengurangan, swdmBase, swdmPageView, bandingBiaya, FE_MOTOR } from '../src/carbon.js';

const r4 = (n) => Number(n.toFixed(4));

test('faktor emisi motor = 0,082 kgCO2e/km (Kalkulator Hijau V2 BI)', () => assert.equal(FE_MOTOR, 0.082));

test('emisi delivery per titik asal sesuai studi kasus Bab 4.2.1', () => {
  assert.equal(r4(emisiDelivery(0.95)), 0.0779); // FILKOM UB
  assert.equal(r4(emisiDelivery(1.5)), 0.123);   // FK UB
  assert.equal(r4(emisiDelivery(1.3)), 0.1066);  // FEB UB
});

test('total 0,3075 kgCO2e, rata-rata 0,1025 per pesanan, 100% pengurangan', () => {
  const total = [0.95, 1.5, 1.3].reduce((a, d) => a + emisiDelivery(d), 0);
  assert.equal(r4(total), 0.3075);
  assert.equal(r4(total / 3), 0.1025);
  assert.equal(emisiSelfPickup(), 0);
  assert.equal(persenPengurangan(total, 0), 100);
  assert.equal(r4(deltaTransport(3.75)), 0.3075);
});

test('ekstrapolasi 100 pesanan ≈ 10,25 kgCO2e dan ≈ 123 kgCO2e/tahun', () => {
  const per = 0.3075 / 3;
  assert.equal(Number((100 * per).toFixed(2)), 10.25);
  assert.equal(Math.round(100 * per * 12), 123);
});

test('persenPengurangan aman untuk emisi awal 0', () => assert.equal(persenPengurangan(0, 0), 0));

test('SWDM v4: 1 GB dengan CI 494 → 148,2 gCO2e (total 0,300 kWh/GB × 494)', () => {
  assert.ok(Math.abs(swdmBase(1e9) - 148.2) < 1e-9);
});

test('SWDM v4: C_pageview = base × NVR + base × RVR × (1 − DCR)', () => {
  const v = swdmPageView(1e9, { nvr: 0.75, rvr: 0.25, dcr: 0.02 });
  assert.ok(Math.abs(v - (148.2 * 0.75 + 148.2 * 0.25 * 0.98)) < 1e-9);
  assert.ok(Math.abs(swdmPageView(1e9, { nvr: 1, rvr: 0, dcr: 0 }) - 148.2) < 1e-9);
});

test('SWDM v4: GHF mengurangi hanya komponen operasional data center', () => {
  const full = swdmBase(1e9, { ghf: 0 }), green = swdmBase(1e9, { ghf: 1 });
  assert.ok(Math.abs(full - green - 0.055 * 494) < 1e-9);
});

test('perbandingan biaya: hemat = ongkir + biaya layanan', () => {
  const b = bandingBiaya({ subtotal: 15000, ongkir: 8000, biayaLayanan: 3000 });
  assert.deepEqual(b, { delivery: 26000, pickup: 15000, hemat: 11000 });
});
