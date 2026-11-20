// Perhitungan emisi CO2e (fungsi murni, lihat Bab 3.4 laporan).

// ---- Emisi transportasi (Kalkulator Hijau V2 Bank Indonesia) ----
export const FE_MOTOR = 0.082; // kgCO2e/km, sepeda motor bensin RON 90

export const emisiDelivery = (jarakKm, fe = FE_MOTOR) => jarakKm * fe;      // E(delivery) = D x FE
export const emisiSelfPickup = () => 0;                                      // jalan kaki: emisi langsung BBM = 0
export const deltaTransport = (jarakKm) => emisiDelivery(jarakKm) - emisiSelfPickup(); // dE
export const persenPengurangan = (sebelum, sesudah) => (sebelum <= 0 ? 0 : ((sebelum - sesudah) / sebelum) * 100);

// ---- Emisi digital: Sustainable Web Design Model (SWDM) v4 ----
export const SWDM = {                       // kWh per GB
  dc:  { nama: 'Data center',      op: 0.055, em: 0.012 },
  net: { nama: 'Jaringan',         op: 0.059, em: 0.013 },
  ud:  { nama: 'Perangkat pengguna', op: 0.080, em: 0.081 },
};
export const CI_GLOBAL = 494;               // gCO2e/kWh (nilai bawaan SWDM v4)
export const BYTES_PER_GB = 1e9;
export const DEFAULTS = { nvr: 0.75, rvr: 0.25, dcr: 0.02, ghf: 0 }; // asumsi awal, ubah sesuai pengujian

const op = (k, dGB, ci) => dGB * SWDM[k].op * ci;   // OP_i = D x EI_op x CI
const em = (k, dGB, ci) => dGB * SWDM[k].em * ci;   // EM_i = D x EI_em x CI

export function swdmKomponen(bytes, { ci = CI_GLOBAL } = {}) {
  const dGB = bytes / BYTES_PER_GB;
  return Object.keys(SWDM).map((k) => ({ key: k, nama: SWDM[k].nama, op: op(k, dGB, ci), em: em(k, dGB, ci) }));
}
// C_base = [OP_DC(1-GHF)+EM_DC] + [OP_N+EM_N] + [OP_UD+EM_UD]   (gCO2e)
export function swdmBase(bytes, { ghf = 0, ci = CI_GLOBAL } = {}) {
  const dGB = bytes / BYTES_PER_GB;
  return op('dc', dGB, ci) * (1 - ghf) + em('dc', dGB, ci) + op('net', dGB, ci) + em('net', dGB, ci) + op('ud', dGB, ci) + em('ud', dGB, ci);
}
// C_pageview = C_base x NVR + C_base x RVR x (1 - DCR)   (gCO2e per page view)
export function swdmPageView(bytes, { nvr = DEFAULTS.nvr, rvr = DEFAULTS.rvr, dcr = DEFAULTS.dcr, ghf = DEFAULTS.ghf, ci = CI_GLOBAL } = {}) {
  const base = swdmBase(bytes, { ghf, ci });
  return base * nvr + base * rvr * (1 - dcr);
}

// ---- Biaya (perbandingan komponen biaya, bukan data transaksi nyata) ----
export function bandingBiaya({ subtotal, ongkir, biayaLayanan }) {
  const delivery = subtotal + ongkir + biayaLayanan;
  return { delivery, pickup: subtotal, hemat: delivery - subtotal };
}
