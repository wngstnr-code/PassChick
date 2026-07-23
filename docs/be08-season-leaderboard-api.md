# BE-08 Season Leaderboard API

**Status:** DRAFT — menunggu sign-off FE-08
**Updated:** 2026-07-23

## Ringkasan

Endpoint publik (tanpa auth) untuk menampilkan papan peringkat musim (season) per
divisi, termasuk zona promosi/degradasi dan posisi pemain (`viewer`) bila
wallet-nya dikirim. Dibangun di atas `season_points`, `divisions`, dan `seasons`
(lihat `backend/database/schema_v2.sql`) serta logic murni di
`backend/src/services/seasonService.ts` (`rankStandings`,
`computeDivisionMovements`).

## Endpoint

### `GET /api/leaderboard/season`

Public — tidak butuh `Authorization` header, konsisten dengan `GET /api/leaderboard`
dan `GET /api/leaderboard/profit` di file yang sama.

#### Query params

| Param      | Wajib | Default  | Keterangan                                                                 |
|------------|-------|----------|-----------------------------------------------------------------------------|
| `division` | tidak | `ROOKIE` | Salah satu dari `ROOKIE`, `RUNNER`, `STEADY`, `ELITE`, `ORACLE`. Selain itu → 400. |
| `wallet`   | tidak | -        | Address pemain untuk mengisi blok `viewer` (posisi pemain tsb.).            |
| `limit`    | tidak | `50`     | Jumlah baris standings per halaman. Di-clamp ke maksimum `100`.             |
| `offset`   | tidak | `0`      | Offset pagination atas standings yang sudah terurut.                        |

`division` dan `wallet` tidak case-sensitive (di-normalize ke uppercase /
lowercase secara internal).

#### Response 200

```json
{
  "success": true,
  "season": {
    "seasonNumber": 1,
    "startsAt": "2026-07-01T00:00:00.000Z",
    "endsAt": "2026-08-01T00:00:00.000Z",
    "status": "ACTIVE"
  },
  "division": "ROOKIE",
  "standings": [
    {
      "rank": 1,
      "walletAddress": "0xabc...",
      "points": 42,
      "lastPointAt": "2026-07-20T10:00:00.000Z",
      "zone": "PROMOTION",
      "movement": null
    }
  ],
  "zones": {
    "promotionCount": 3,
    "relegationCount": 0,
    "activePlayers": 12,
    "smallDivision": true
  },
  "viewer": {
    "walletAddress": "0xdef...",
    "division": "RUNNER",
    "rank": 12,
    "points": 3,
    "zone": "SAFE"
  },
  "total": 57,
  "limit": 50,
  "offset": 0
}
```

`viewer` bernilai `null` jika parameter `wallet` tidak dikirim, atau wallet
tersebut belum punya baris `season_points` pada musim aktif (mis. belum pernah
mengumpulkan poin di musim berjalan). Divisi viewer diambil dari tabel
`divisions` (default `ROOKIE` bila belum ada baris) — **bukan** parameter
`division` di query — dan rank-nya dihitung di divisi milik viewer sendiri
(query terpisah bila berbeda dari `division` yang diminta).

#### Response 400 — division tidak valid

```json
{
  "success": false,
  "error": "Invalid division. Must be one of: ROOKIE, RUNNER, STEADY, ELITE, ORACLE"
}
```

#### Response 503 — season system belum siap

Dikembalikan bila `getCurrentSeason()` tidak menemukan season aktif (tabel
`seasons` kosong/belum di-bootstrap), atau bila tabel V2 (`seasons`,
`season_points`, `divisions`) belum di-apply ke database (error Postgres
"relation ... does not exist" ditangkap secara eksplisit dan dipetakan ke 503,
bukan 500):

```json
{
  "success": false,
  "error": "Season system is not initialized yet."
}
```

#### Response 500 — error tak terduga

```json
{ "success": false, "error": "Internal server error." }
```

## Semantik ranking & zona

### Urutan (tie-break)

Standings diurutkan memakai `rankStandings()`:
1. `points` **DESC**.
2. `last_point_at` **ASC** — pemain yang lebih dulu mencapai total poin
   tersebut menang tie. Baris tanpa `last_point_at` dianggap "tercapai
   paling akhir" pada kelompok poin yang sama.
3. `wallet_address` (leksikografis) sebagai tie-break terakhir yang
   deterministik.

Karena poin `0` selalu berada di bawah poin `> 0`, pemain pasif otomatis
muncul setelah pemain aktif dalam urutan `rank` yang sama (rank berlanjut,
tidak di-reset).

### Zona per baris (`zone`)

| Zone         | Kondisi                                                                 |
|--------------|--------------------------------------------------------------------------|
| `PASSIVE`    | `points === 0`. Pemain pasif **tidak pernah** ditandai `PROMOTION`/`RELEGATION` di tampilan ini, meskipun secara aturan settlement (§5.2) pemain pasif di RUNNER+ tetap otomatis degradasi saat musim ditutup. |
| `PROMOTION`  | Wallet termasuk dalam himpunan promosi hasil `computeDivisionMovements()` untuk divisi ini. |
| `RELEGATION` | Wallet termasuk dalam himpunan degradasi hasil `computeDivisionMovements()`. |
| `SAFE`       | Selain ketiganya di atas.                                               |

### Ringkasan zona (`zones`)

- `promotionCount` / `relegationCount`: ukuran himpunan promosi/degradasi
  dari `computeDivisionMovements()` (termasuk auto-relegate pemain pasif di
  RUNNER+, sekalipun baris individual pemain pasif ditampilkan sebagai
  `PASSIVE`, bukan `RELEGATION`, di array `standings`).
- `activePlayers`: jumlah pemain dengan `points > 0` di divisi ini.
- `smallDivision`: `true` bila `activePlayers < 20`.

### Aturan divisi kecil & batas divisi

- **Divisi kecil** (`activePlayers < 20`): degradasi persentase ditiadakan;
  promosi = Top 3 pemain aktif (atau kurang bila pemain aktif < 3).
- **ORACLE**: tidak pernah promosi (`promotionCount` selalu 0).
- **ROOKIE**: tidak pernah degradasi (`relegationCount` selalu 0, kecuali
  dari mekanisme lain yang tidak berlaku di ROOKIE).
- Persentase promosi/degradasi lain mengikuti `PROMOTION_PCT` /
  `RELEGATION_PCT` di `seasonService.ts`, dibulatkan ke bawah, minimum 1
  pemain untuk promosi bila `activePlayers > 0`.

### `movement`

Nilai kolom `movement` di `season_points` (`PROMOTED` | `RELEGATED` | `STAYED`
| `null`). Selama season berstatus `ACTIVE`/`FREEZING`, kolom ini masih
`null` — nilai final baru terisi setelah `applyMovements()` berjalan saat
settlement (lihat `seasonService.ts`). `zone` di response ini adalah proyeksi
**real-time** dari standings saat ini, bukan hasil final `movement`; keduanya
bisa berbeda sesaat sebelum season ditutup.

## Perilaku saat freeze / settlement

Endpoint ini **tidak menyembunyikan** status non-`ACTIVE`. Selama
`status` season adalah `FREEZING`, `SETTLING`, atau `SETTLED` (untuk musim
yang belum sepenuhnya settled — lihat `getCurrentSeason()`), response tetap
200 dengan standings apa adanya dan `season.status` menunjukkan state
tersebut. Frontend disarankan menampilkan banner "leaderboard dibekukan" bila
`status !== "ACTIVE"`.

## Contoh panggilan

```
GET /api/leaderboard/season?division=RUNNER&limit=20&offset=0
GET /api/leaderboard/season?division=ROOKIE&wallet=0xabc...def
```

## Catatan koordinasi

- Tidak ada perubahan skema atau kontrak smart contract yang dibutuhkan untuk
  endpoint ini — murni baca dari `season_points` / `divisions` / `seasons`
  yang sudah ada di `schema_v2.sql`.
- Jika FE butuh field tambahan (mis. avatar, nama), itu perlu endpoint
  gabungan terpisah atau join tambahan — belum termasuk di scope B8 ini.
