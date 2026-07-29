# BE-07 — Kontrak Game Session V2 (One-Ticket Play)

**Status:** DIIMPLEMENTASIKAN di backend di belakang flag `GAME_V2_TICKET_MODE`
(default off) — menunggu sign-off FE untuk cutover FE-07. Perubahan kontrak
masih bisa dinegosiasikan sebelum flag dinyalakan.
**Terverifikasi end-to-end 2026-07-29** dengan flag ON di Celo Sepolia:
38/38 cek lolos lewat `backend/scripts/e2e-v2-ticket-play.mjs` (debit tiket,
replay idempotent, SESSION_ALREADY_ACTIVE, poin §5.1, crash, INSUFFICIENT_TICKETS,
SESSION_CONSUMED, recovery GET, dan refund orphan tanpa move). Satu deviasi §4
ditemukan dan diperbaiki di run itu — lihat catatan di §4.
**Updated:** 2026-07-29
**Sumber kebijakan:** `update_v2.md` §5.1, §9.2, §13.3-B4; `docs/frontend-v2-roadmap.md` FE-07

Kontrak ini menggantikan flow stake USDC + GameSettlement V1. Setelah cutover,
path V2 **tidak memanggil** GameSettlement, tidak membuat settlement signature,
dan tidak membangun transaksi on-chain apa pun untuk memulai match.

---

## 1. Prinsip

1. **1 match = 1 tiket**, didebit **off-chain** dari mirror `ticket_balances`
   (mirror dijaga oleh event listener on-chain: `TicketClaimed`, `TicketCredited`,
   `TicketPurchased`, dikurangi ledger spend off-chain).
2. **Backend authoritative.** Frontend tidak pernah menghitung saldo tiket,
   poin, atau checkpoint final sendiri; server menghitung dari state move yang
   ia lacak sendiri.
3. **Session token tidak cukup untuk mutasi bernilai bebas** (update_v2 §13.1-A).
   Debit tiket dijangkarkan ke saldo mirror on-chain — server tidak akan pernah
   mendebit melebihi saldo yang terbukti dari event chain. Auth sudah
   di-harden (reject provider tak dikenal + rate limit). Tidak ada sign-message
   (dilarang MiniPay); tidak ada tx wallet untuk start match.
4. **Transport:** gameplay tetap **Socket.IO** di gateway yang sama
   (handshake auth token seperti sekarang). Recovery lewat **HTTP GET**.
5. **Feature flag:** backend `GAME_V2_TICKET_MODE=true` mengaktifkan kontrak
   ini; selama flag off, gateway menjalankan flow stake V1 apa adanya. FE
   memakai flag sisi klien yang sepadan sehingga ketiga layer bisa cutover
   bersama (delivery rule FE-07).

---

## 2. Memulai match — `game:start` (WS)

### Request (client → server)

```json
{
  "clientSessionId": "3f6f9a4e-8f4b-4b1e-9d51-2a4bb0d7c9aa"
}
```

- `clientSessionId`: UUID v4 yang dibuat frontend **sekali per niat-main** dan
  dipakai ulang pada setiap retry dari niat yang sama. Ini kunci idempotency.
- Tidak ada field `stake`. Tidak ada `onchainSessionId`.

### Response sukses (server → client), event `game:started`

```json
{
  "success": true,
  "session": {
    "sessionId": "b7b1…",            
    "clientSessionId": "3f6f9a4e-…",
    "ticketCost": 1,
    "ticketBalanceAfter": "6",
    "seasonId": "2026-08",
    "division": "ROOKIE",
    "startedAt": "2026-07-23T09:12:00.000Z"
  },
  "replayed": false
}
```

- `ticketBalanceAfter`: string integer, saldo tiket authoritative setelah debit.
- `replayed: true` berarti ini balasan idempotent untuk `clientSessionId` yang
  sudah pernah berhasil — **tidak ada debit kedua**.

### Response gagal, event `game:start_error`

```json
{
  "success": false,
  "code": "INSUFFICIENT_TICKETS",
  "message": "Saldo tiket kamu 0. Klaim harian atau top-up dulu.",
  "retryable": false,
  "data": { "ticketBalance": "0" }
}
```

### Aturan idempotency & anti-double-debit (jaminan server)

1. Debit dilakukan lewat satu operasi atomik di Postgres:
   `UPDATE ticket_balances SET available = available - 1 WHERE wallet = $1 AND available >= 1`
   + insert baris ledger `ticket_ledger(kind='SPEND', session_id UNIQUE)` dalam
   satu transaksi. Race dua koneksi → hanya satu yang menang.
2. `clientSessionId` unik per wallet di tabel sesi. Start ulang dengan id sama →
   balasan `game:started` yang sama (`replayed: true`), bukan debit baru.
3. Satu wallet maksimal **satu sesi ACTIVE**. Start dengan `clientSessionId`
   *baru* saat masih ada sesi ACTIVE → `SESSION_ALREADY_ACTIVE` (tidak ada debit).
4. Satu `start` sukses = tepat satu baris ledger SPEND. Concurrent/retried start
   tidak pernah menghasilkan dua baris.

---

## 3. Selama match

Tetap seperti sekarang: `game:move { direction }` dilacak server;
validator server menghitung progres/checkpoint — klien tidak mengirim skor.

## 4. Mengakhiri match

Dua jalan, dua-duanya idempotent per `sessionId`:

- **`game:crash`** — pemain kalah. Server menutup sesi dengan checkpoint
  terakhir yang ia lacak sendiri.
- **`game:end_run`** — pemain berhenti secara sadar (pengganti `game:cashout`;
  tidak ada uang yang berpindah).

### Response, event `game:ended`

```json
{
  "success": true,
  "result": {
    "sessionId": "b7b1…",
    "status": "CRASHED",
    "finalCheckpoint": 4,
    "pointsAwarded": 3,
    "seasonPointsTotal": 27,
    "seasonId": "2026-08",
    "division": "ROOKIE",
    "ticketBalance": "6",
    "endedAt": "2026-07-23T09:14:31.000Z"
  }
}
```

- `status`: `CRASHED | COMPLETED`.
- `pointsAwarded` mengikuti rumus CP per divisi (update_v2 §5.1); dihitung
  server dari checkpoint yang server lacak. `0` sah (di bawah ambang divisi).
- Mengirim `game:crash`/`game:end_run` dua kali untuk sesi yang sudah tutup →
  balasan `game:ended` yang sama, tanpa poin ganda.
  > Tes E2E 2026-07-29 menemukan backend dulu membalas `game:error`
  > ("No active game session") untuk pengiriman kedua, karena state in-memory
  > sudah dibuang. Poin tidak pernah ganda, tapi FE bisa menampilkan error
  > padahal match-nya sukses. Sudah diperbaiki: gateway membaca hasil tersimpan
  > dan mengulang `game:ended` yang sama. Jendela replay **60 detik** sejak
  > `ended_at` — di luar itu tetap `game:error`, karena `end_run` yang datang
  > jauh belakangan bukan duplikat melainkan memang tidak punya sesi aktif.
- Setelah `game:ended`, FE cukup invalidate query tiket + season (roadmap FE-07
  butir 2); tidak ada submit settlement dan tidak ada pending-settlement di path V2.

---

## 5. Recovery sesi — `GET /api/game/session/active` (HTTP, auth)

Dipanggil FE saat mount/reconnect sebelum menawarkan tombol main.

```json
{
  "active": true,
  "session": {
    "sessionId": "b7b1…",
    "clientSessionId": "3f6f9a4e-…",
    "startedAt": "2026-07-23T09:12:00.000Z",
    "resumable": false
  }
}
```

Kebijakan (disepakati 2026-07-23):

- Sesi ACTIVE yang **orphan** (server restart — game state in-memory hilang,
  atau melewati TTL tanpa aktivitas) ditutup otomatis oleh recovery worker:
  - **Belum ada satu pun move tercatat** → sesi ditandai `VOIDED` dan tiket
    **di-refund** (baris ledger `REFUND`, idempotent per sesi — maksimal satu
    refund per SPEND).
  - **Sudah ada progres** → ditandai `CRASHED` dengan checkpoint terakhir yang
    sempat dipersist; tiket hangus, poin dihitung normal.
- `resumable` selalu `false` di V2 awal (tidak ada resume mid-run); field
  disediakan agar schema tidak breaking kalau resume dibangun nanti.
- FE tidak perlu lagi memanggil `pending-settlement` / `force-end-active` di
  path V2; endpoint lama tetap hidup untuk sesi V1 lawas sampai bersih.

---

## 6. Error codes

Berlaku untuk `game:start_error` (WS) dan HTTP (field `code` di body error).

| Code | Kapan | retryable | Aksi FE |
|---|---|---|---|
| `UNAUTHENTICATED` | Token session tidak ada/kedaluwarsa | setelah re-auth | Jalankan ulang `ensureBackendSession` |
| `INSUFFICIENT_TICKETS` | Saldo mirror < 1 | tidak | Arahkan ke daily claim / TOP UP |
| `SESSION_ALREADY_ACTIVE` | Ada sesi ACTIVE lain (data sesi ikut di `data.activeSession`) | setelah resolve | Panggil recovery GET, tampilkan state |
| `TICKET_STATE_SYNCING` | Mirror belum terinisialisasi / listener tertinggal | ya (backoff) | Tampilkan "menyinkronkan saldo…", retry |
| `SEASON_FROZEN` | Start di jendela reset season | ya (tunggu) | Tampilkan countdown season baru |
| `RATE_LIMITED` | Limit start per wallet/IP | ya (backoff) | Backoff + retry |
| `INTERNAL` | Kegagalan tak terduga | ya | Retry dengan `clientSessionId` yang sama |
| `INVALID_REQUEST` | `clientSessionId` bukan UUID v4 | tidak | Perbaiki payload |
| `SESSION_CONSUMED` | `clientSessionId` sudah dipakai sesi yang selesai, ATAU sesi orphan dari proses lama baru saja di-void+refund | ya jika `retryable:true` | Generate `clientSessionId` baru lalu start ulang |

Bentuk error HTTP: `{ "success": false, "code": "…", "message": "…" }` dengan
status 401 / 402→? (pakai 409 untuk `SESSION_ALREADY_ACTIVE`, 422 untuk
`INSUFFICIENT_TICKETS`, 503 untuk `TICKET_STATE_SYNCING`/`SEASON_FROZEN`,
429 untuk `RATE_LIMITED`, 500 untuk `INTERNAL`).

---

## 7. Yang dihapus dari path V2

- `game:start { stake }`, validasi MIN/MAX stake, `buildStartSessionTransaction`,
  `readActiveOnchainSession` sebagai prasyarat start.
- `game:cashout` (uang), settlement signature, `submitSettlementOnchain`,
  `pending-settlement`, `clear-settlement` — semuanya tinggal untuk V1 legacy
  sampai tidak ada sesi V1 tersisa, lalu dipensiunkan.
- `POST /api/game/start-session` (HTTP V1) tidak dipakai V2.

## 8. Pertanyaan terbuka (perlu jawaban FE/produk, bukan blocker draft)

1. Saat `SEASON_FROZEN`, apakah FE mau tetap mengizinkan "main santai" tanpa
   poin? Default backend: **blokir start** selama jendela reset (jendelanya
   menit-an, bukan jam).
2. Nama event final `game:end_run` vs mempertahankan nama `game:cashout` demi
   diff engine yang lebih kecil — backend fleksibel, tinggal sepakat.
