# PassChick v2.0 — Spesifikasi Lengkap

**Status:** Draft final untuk implementasi
**Target:** Submit listing Mini App di MiniPay
**Terakhir diupdate:** 2026-07-17

---

## 1. Ringkasan & Tujuan

PassChick v2 mengganti model *stake USDC per match* menjadi model **Tiket + Leaderboard musiman**. Alasan utama:

1. **Kelayakan listing MiniPay.** Model "taruh USDC, kalah = hangus" terbaca sebagai real-money gambling oleh reviewer (MiniPay didistribusikan via Google Play/Opera Mini yang ketat soal ini). Model tiket + kompetisi skill musiman masuk kategori "games" yang didukung.
2. **Retensi.** Daily login, season 2-mingguan, dan sistem divisi memberi alasan user kembali setiap hari.
3. **Metrik on-chain.** Program insentif builder MiniPay (hingga $1 juta CELO) dinilai dari aktivitas transaksi nyata. Desain v2 menghasilkan minimal 1 tx on-chain per user aktif per hari.

**Semua pemain (lama & baru) mulai dari Divisi Rookie saat v2 rilis.**

---

## 2. Sistem Tiket

### 2.1 Sifat tiket

- **1 match = 1 tiket.** Tidak ada lagi stake USDC per match.
- Tiket **non-transferable** — bukan ERC-20 yang bisa dipindah/diperdagangkan. Disimpan sebagai balance internal di kontrak `TicketVault`. Alasan: mencegah pasar tiket & bot trading, dan menyederhanakan review konten MiniPay.
- Tiket **tidak hangus** saat season reset. Bisa ditabung lintas season.

### 2.2 Sumber tiket

| Sumber | Mekanisme | On-chain? |
|---|---|---|
| Daily login | Klaim harian dengan streak 7 hari (lihat §3) | ✅ 1 tx/hari |
| Top-up | Beli pakai stablecoin via `TicketShop` (lihat §4) | ✅ |
| Reward season | Bonus tiket untuk peringkat atas divisi (lihat §6) | ✅ (batch kredit) |
| Konversi saldo lama | Migrasi saldo GameVault dengan bonus 10% (lihat §10) | ✅ |
| Perk passport | +1 tiket daily untuk tier tertentu (lihat §7) | ✅ (menempel di daily claim) |

---

## 3. Daily Login Reward

Siklus 7 hari, reset kembali ke Hari 1 setiap minggu (atau saat streak putus — lihat keputusan §3.2):

| Hari | Reward |
|---|---|
| 1 | 5 tiket |
| 2 | 🎁 Mystery Box (acak 1–10 tiket) |
| 3 | 7 tiket |
| 4 | 🎁 Mystery Box (acak 1–10 tiket) |
| 5 | 9 tiket |
| 6 | 🎁 Mystery Box (acak 1–10 tiket) |
| 7 | 10 tiket |

### 3.1 Mekanisme klaim (on-chain)

1. User membuka app → backend menghitung `dayIndex` streak dan (untuk mystery box) me-roll jumlah tiket secara server-side.
2. Backend menandatangani EIP-712: `DailyClaim(address user, uint32 dayIndex, uint16 amount, uint256 deadline, uint256 nonce)`.
3. User submit tx `claimDaily(claim, signature)` ke `TicketVault` → kontrak verifikasi signature signer backend, kredit tiket, emit `TicketClaimed`.
4. Kontrak menolak klaim ganda per hari (tracking `lastClaimDay` per user).

Gas ≈ nol di Celo dan dibayar stablecoin otomatis oleh MiniPay — friksi minimal. Pola signer EIP-712 memakai infrastruktur yang sudah ada di GameSettlement.

### 3.2 Keputusan desain

- **Streak putus** (skip 1 hari): reset ke Hari 1. Sederhana dan mendorong login harian.
- **Mystery box** dirol backend (bukan on-chain randomness) — dapat diterima karena reward-nya gratis, bukan barang berbayar.
- **Perk passport** (+1 tiket) digabung ke `amount` dalam signature yang sama, bukan tx terpisah.

---

## 4. Top-Up Tiket (Multi-Stablecoin)

### 4.1 Harga

**$1 = 20 tiket** ($0.05/tiket). Semua stablecoin dihargai 1:1 terhadap USD, tanpa kurs antar token.

### 4.2 Token yang diterima

Whitelist di kontrak `TicketShop`:

| Token | Alamat (Celo Mainnet) | Desimal |
|---|---|---|
| USDC | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | 6 |
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 |
| cUSD | `0x765DE816845861e75A25fCA122bb6898B8B1282a` | 18 |

Catatan implementasi:

- Simpan konfigurasi `(token → decimals, enabled)` di kontrak; owner bisa menambah token (mis. USDm) tanpa upgrade.
- **Wajib `SafeERC20`** — USDT tidak sepenuhnya standar di return value.
- Dana top-up masuk ke treasury; 5% revenue per season dialokasikan ke royalty pool Oracle (lihat §6).
- UI: deteksi token dengan saldo terbesar di wallet user, jadikan default → pembelian satu klik. Jika saldo kurang, deeplink ke flow "Add Cash" MiniPay (best practice resmi).

---

## 5. Divisi, Poin & Leaderboard

### 5.1 Perolehan poin

Poin didapat dari pencapaian Checkpoint (CP) per match. Ambang CP pertama yang menghasilkan poin naik per divisi:

| Divisi | Poin mulai dari | Skema |
|---|---|---|
| 🥉 Rookie | CP 2 | CP 2 = 1 poin, CP 3 = 2 poin, dst. |
| 🥈 Runner | CP 3 | CP 3 = 1 poin, CP 4 = 2 poin, dst. |
| 🥇 Steady | CP 4 | CP 4 = 1 poin, CP 5 = 2 poin, dst. |
| 💎 Elite | CP 5 | CP 5 = 1 poin, CP 6 = 2 poin, dst. |
| 👑 Oracle | CP 6 | CP 6 = 1 poin, CP 7 = 2 poin, dst. |

### 5.2 Promosi & degradasi (berbasis persentase)

| Divisi | Promosi | Degradasi |
|---|---|---|
| Rookie | Top 20% | — |
| Runner | Top 15% | Bottom 15% |
| Steady | Top 10% | Bottom 15% |
| Elite | Top 10% | Bottom 20% |
| Oracle | — (puncak) | Bottom 25% |

Aturan pengaman:

- Pembulatan **ke bawah**, minimum **1 pemain** untuk promosi.
- **Divisi kecil:** jika pemain aktif (poin > 0) dalam satu divisi < 20 orang, degradasi ditiadakan dan promosi menjadi fixed **Top 3**. Ini mencegah matematika persentase patah di season-season awal.
- **Pemain pasif:** poin 0 selama satu season di divisi Runner ke atas → auto-degradasi satu tingkat. Pemain pasif tidak dihitung dalam basis persentase bottom.

### 5.3 Tie-breaker

Poin sama → peringkat lebih tinggi untuk yang **mencapai total poin tersebut lebih dulu** (timestamp poin terakhir yang membentuk total). Siapa cepat, dia dapat.

### 5.4 Tampilan

Level Passport user otomatis menampilkan divisi saat ini (visual tier di passport = divisi).

---

## 6. Reward per Divisi

Prinsip: **reward bernilai uang hanya di level di mana biaya farming melebihi nilai reward.** Divisi bawah mendapat reward non-moneter (tiket & kosmetik) sehingga farming multi-akun tidak menghasilkan apa-apa.

| Divisi | Penerima | Reward |
|---|---|---|
| 🥉 Rookie | Top 20% (promosi) | 5–10 tiket + badge "Season X Survivor" di passport |
| 🥈 Runner | Top 15% | 15 tiket + skin ayam eksklusif season |
| 🥇 Steady | Top 10% | $1–2 stablecoin + skin + 20 tiket |
| 💎 Elite | Top 10% | $3–5 stablecoin + skin animasi + frame passport Elite |
| 👑 Oracle | Top 5 | Grand prize CELO + gelar permanen on-chain ("Oracle S1") + **royalty 5% revenue top-up season itu** dibagi ke Top 5 |

Catatan:

- **Royalty Oracle self-funding**: diambil dari revenue tiket season berjalan, bukan treasury — makin ramai game, makin besar hadiah puncak. Insentif organik bagi pemain top untuk mempromosikan game.
- **Skin bersifat seasonal-exclusive**: tidak bisa didapat lagi setelah season berakhir. Ini retention hook termurah yang kita punya.
- Nominal pasti stablecoin/CELO di-finalkan per season berdasarkan revenue; angka di tabel adalah rentang target awal.
- **Syarat pencairan reward moneter: passport verified** (lihat §7.1).

---

## 7. Trust Passport v2

Passport berubah dari "gerbang masuk sekali klaim" menjadi **identitas karir pemain**. Tiga lapis:

### 7.1 Gate ekonomi (anti-sybil — paling penting)

- Main & naik leaderboard: **terbuka untuk semua** (cukup punya passport dasar).
- **Klaim reward bernilai uang** (stablecoin, CELO, royalty): hanya untuk passport berstatus **verified human** via **Self.xyz** (protokol verifikasi identitas native Celo, gratis, privacy-preserving).
- Reward non-moneter (tiket, skin, badge) tidak butuh verifikasi.
- Ini adalah jawaban resmi kita ke reviewer MiniPay atas pertanyaan bot/sybil: *anti-bot by design* — tiket non-transferable + reward bawah non-moneter + pencairan uang butuh verified human = tiga lapis pertahanan.

### 7.2 Perk per tier

Tier passport naik dari **akumulasi pencapaian lintas season** (tidak bisa dibeli):

| Tier | Syarat (contoh) | Perk |
|---|---|---|
| Runner (dasar) | Klaim passport | Bisa main & masuk leaderboard |
| Veteran | Selesaikan 1 season penuh (poin > 0) | +1 tiket di setiap daily claim |
| Elite Badge | Pernah promosi ke Steady+ | Bonus 5% tiket saat top-up |
| Oracle Mark | Pernah masuk Oracle | Mystery box di-upgrade: range 3–10 (bukan 1–10) |

### 7.3 Kanvas karir

- Skin, badge season, gelar Oracle — semua menempel di passport dan tampil di leaderboard & profil.
- Riwayat divisi per season tercatat on-chain (event/mapping di kontrak passport) — "pernah Oracle di S1" permanen selamanya.
- Passport = trophy cabinet yang tidak mau ditinggalkan user.

---

## 8. Sistem Season

- Durasi: **2 minggu**.
- Reset otomatis setiap **Senin 07:00 WIB (Minggu 24:00 UTC)** — timezone dikunci WIB, ditampilkan di UI sebagai countdown (bukan jam absolut) agar tidak ambigu bagi user global.
- Urutan proses reset (job backend):
  1. Freeze leaderboard (snapshot poin + timestamp tie-break).
  2. Hitung promosi/degradasi per aturan §5.2.
  3. Kredit reward tiket (batch on-chain) & tandai reward moneter *claimable* (user klaim sendiri, gate verified §7.1).
  4. Update tier/badge passport.
  5. Buka season baru, poin semua pemain = 0.
- Tiket **tidak direset**. Divisi **tidak direset** (hanya berubah via promosi/degradasi).

---

## 9. Arsitektur On-Chain & Off-Chain

### 9.1 Kontrak baru

| Kontrak | Fungsi |
|---|---|
| `TicketVault` | Balance tiket internal per user (non-transferable). `claimDaily(claim, sig)`, `creditBatch()` (reward season), event `TicketClaimed`, `TicketCredited`, `TicketSpent` |
| `TicketShop` | `buyTickets(token, usdAmount)` — whitelist stablecoin, SafeERC20, transfer ke treasury, kredit tiket ke TicketVault. Bisa digabung jadi satu kontrak dengan TicketVault |

Kontrak lama:

- **TrustPassport** — diperluas (tier lintas season, status verified Self.xyz, badge/gelar). Sudah UUPS, bisa di-upgrade.
- **GameSettlement** — tetap dipakai untuk settlement hasil match (EIP-712 signer sudah ada).
- **GameVault** — masuk mode withdraw-only (lihat §10).

### 9.2 Pembagian on-chain vs off-chain

| Operasi | Lokasi | Alasan |
|---|---|---|
| Daily claim | On-chain (user submit tx) | Metrik aktivitas MiniPay, 1 tx/user/hari |
| Top-up | On-chain | Pembayaran nyata |
| Pemakaian tiket per match | **Off-chain** (backend debet mirror balance dari event on-chain) | Gameplay harus instan, tanpa friksi tx per match; opsional settle batch berkala via `TicketSpent` |
| Poin & leaderboard | Off-chain (Supabase) | Frekuensi tinggi, tidak butuh trust on-chain |
| Reward season | Kredit tiket on-chain batch; reward uang claimable on-chain | Auditable |

### 9.3 Bonus traction

Semua event `TicketClaimed` / `TicketPurchased` langsung terbaca dashboard Dune yang sudah ada → metrik traction harian gratis untuk laporan grant/insentif.

---

## 10. Migrasi Saldo GameVault (User Lama)

1. **Saat v2 rilis:** GameVault masuk **withdraw-only** — deposit dimatikan di UI dan (jika kontrak mendukung pause per fungsi) di kontrak. Tombol withdraw ditempatkan mencolok.
2. **Konversi berinsentif:** satu klik "Convert ke tiket" dengan **bonus 10%** ($1 saldo = 22 tiket). Bonus berlaku **30 hari pertama** setelah rilis v2.
3. **Withdraw tersedia selamanya.** Tidak ada force-convert, tidak ada deadline withdraw — itu dana user.
4. Komunikasi: banner in-app + section migrasi di pengumuman update 2.0.

---

## 11. Checklist Listing MiniPay

Status per 2026-07-17:

- [x] Kontrak verified di Celoscan
- [x] Halaman Terms of Service & Privacy Policy
- [x] Deteksi MiniPay (`window.ethereum.isMiniPay`)
- [x] **Auto-connect** — ✅ hasil audit: silent `eth_accounts` dulu, `eth_requestAccounts` hanya jika `isMiniPay` (`WalletProvider.tsx`, `celo.ts`). Sisa PR kecil: sembunyikan tombol LOGIN saat deteksi MiniPay masih berjalan (lihat §13.3-F1)
- [x] **Tidak minta sign message untuk login** — ✅ hasil audit: MiniPay memakai `POST /auth/minipay` tanpa signature; tidak ada `signMessage`/`personal_sign` di seluruh frontend. TAPI ada lubang keamanan di endpoint ini — lihat §13.1 (KRITIS)
- [ ] PageSpeed Insights score tinggi untuk passchick.xyz — saat ini terancam oleh Three.js CDN & font `@import` (§13.3-F2, F3)
- [ ] Icon 512×512 + tagline + kategori (games)
- [ ] Support channel (Telegram/WA/email) + kesiapan SLA: isu kritis fix < 24 jam
- [ ] Network manifest: daftar lengkap semua domain/API/resource eksternal
- [ ] Dependency pinning: versi exact di package.json, lockfile committed, `ignore-scripts=true`
- [ ] Sample transaction link untuk setiap method kontrak yang dipanggil user
- [ ] Handling saldo kurang → deeplink Add Cash MiniPay
- [ ] Touch target min 44×44 px, viewport min 360×640
- [ ] Test di Celo Sepolia (11142220) & Mainnet (42220) dalam container MiniPay

Referensi: [Submit your Mini App](https://docs.minipay.xyz/getting-started/submit-your-miniapp.html) · [Best Practices](https://docs.minipay.xyz/getting-started/best-practices.html)

### 11.1 Checklist Hari-H Submission (di luar kode — verifikasi & persiapan manual)

Item yang tidak bisa "diselesaikan di kode", hanya bisa diverifikasi/disiapkan menjelang submit:

- [ ] **Revisi Terms of Service & Privacy Policy ke model tiket** — halaman legal saat ini masih menjelaskan model stake USDC; ketidakcocokan antara ToS dan app adalah red flag bagi reviewer. Sekalian tambahkan bahasan: tiket non-transferable & tidak bisa di-refund ke uang, mekanisme reward musiman, dan verifikasi Self.xyz untuk pencairan reward
- [ ] **Test manual di container MiniPay asli** (device Android + MiniPay site tester, viewport 360×640): auto-connect, top-up tiap stablecoin, daily claim, saldo kurang → Add Cash, main satu match penuh, klaim reward — bug integrasi WebView sering baru terlihat di sini, bukan di kode
- [ ] **Ukur ulang PageSpeed Insights** untuk passchick.xyz SETELAH F2/F3 selesai — fix di kode ≠ skor bagus; angkanya harus dibuktikan
- [ ] **Deploy kontrak V2 + siapkan sample transaction link** untuk setiap method user-facing di TicketVault/TicketShop (`claimDaily`, `buyTickets`, klaim reward) — form submission memintanya, jadi kontrak V2 harus live dan punya tx contoh SEBELUM submit
- [ ] **Aset form submission**: icon 512×512 px, app name, tagline, publisher, kategori (games), support URL, link ToS & Privacy
- [ ] **Kesiapan operasional SLA**: tentukan siapa yang standby merespons isu kritis < 24 jam (channel: t.me/passchick_support) — listing disuspend jika SLA dilanggar
- [ ] **Finalisasi network manifest** dari environment produksi aktual (domain backend API + Socket.IO, sisa domain eksternal setelah F2/F3 menghapus esm.sh & fonts.googleapis.com)

> **Catatan ekspektasi:** review MiniPay manual dan iteratif — checklist ini menghilangkan semua alasan penolakan dari sisi kita, tapi keputusan akhir di reviewer. Jika ada feedback, perbaiki dan resubmit; itu bagian normal prosesnya, bukan kegagalan.

---

## 12. Pertanyaan Terbuka

- Nominal pasti reward stablecoin/CELO per divisi untuk Season 1 (tergantung budget awal treasury).
- Apakah USDm masuk whitelist top-up sejak hari pertama?
- Mekanik skin: cukup metadata off-chain + render di app, atau NFT? (Rekomendasi awal: off-chain dulu, NFT menyusul jika ada permintaan — jangan tambah scope sebelum listing.)
- Grace period streak daily login (mis. 1 hari toleransi untuk tier Veteran+?) — nice-to-have, bukan blocker.

---

## 13. Hasil Audit Kodebase (2026-07-17) — Temuan & Solusi

Audit menyeluruh tiga modul (`sc/`, `backend/`, `frontend/`) terhadap spec V2 ini dan checklist MiniPay §11. Setiap temuan disertai solusi konkret.

### 13.1 🔴 KRITIS — Keamanan (wajib sebelum V2 punya reward uang)

**A. Autentikasi tidak membuktikan kepemilikan wallet.**
`POST /auth/social` dan `POST /auth/minipay` (`backend/src/routes/auth.ts:105-201`) menerima `{address, chainId}` mentah dan langsung membuat session token untuk address tersebut. Blok validasi `if (!isSocialOrEmbedded)` di `auth.ts:145-149` **kosong** — tidak pernah menolak apa pun. Siapa saja (via `curl`, CORS tidak melindungi non-browser) bisa login sebagai wallet siapa pun.

- Dampak V1: terbatas (settlement uang tetap butuh tx signed wallet asli), tapi identitas leaderboard bisa di-impersonasi.
- Dampak V2: **fatal** — penyerang bisa menghabiskan tiket pemain lain (debit tiket off-chain hanya bermodal session token) dan mencemari poin/leaderboard.
- **Solusi** (sign-message dilarang MiniPay, jadi bukan itu jawabannya):
  1. Isi/perbaiki validasi kosong di `auth.ts:145-149` (reject provider tak dikenal) + rate-limit per IP/address di semua endpoint auth.
  2. Prinsip desain V2: **session token tidak pernah cukup untuk mutasi bernilai.** Klaim daily/reward selalu lewat EIP-712 + tx dari wallet user (sudah sesuai §3.1); debit tiket saat main harus dijangkarkan ke saldo on-chain (mirror dari event), bukan angka bebas di DB.
  3. Operasi baca (leaderboard, profil) boleh tetap session-based.

**B. `BACKEND_PRIVATE_KEY` bersifat optional** (`backend/src/config/env.ts:70`, `optionalEnv` dengan default `""`). Kalau kosong, crash generik saat startup. **Solusi:** ubah ke `requireEnv` agar gagal cepat dengan pesan jelas.

**C. Faucet tidak punya guard anti-mainnet** (`backend/src/services/faucetService.ts:30-32` hanya cek address ter-set). **Solusi:** tolak aktif jika `CHAIN_ID === 42220`.

### 13.2 🟠 Smart Contracts (`sc/`)

Kondisi umum: paling siap di antara tiga modul. Lima kontrak UUPS dengan pola konsisten (`Initializable` + `OwnableUpgradeable` + `PausableUpgradeable`), EIP-712 di GameSettlement & TrustPassport, test coverage layak (41 test).

| # | Temuan | Solusi |
|---|---|---|
| S1 | **Jebakan cutover:** `pause()` GameVault memblokir deposit SEKALIGUS `lockStake`/`settleCashout`/`settleCrash` (`GameVault.sol:82,166,187,213`) — pause saat masih ada sesi V1 aktif = dana pemain macet di `lockedBalances` | Urutan cutover §10 direvisi: matikan deposit **di UI dulu** → tunggu semua sesi V1 settle → baru `pause()`. Alternatif enforce on-chain: upgrade UUPS tambah flag `depositsPaused` terpisah (append storage slot, aman) |
| S2 | TrustPassport belum punya field untuk verified/badge/riwayat season, dan **tidak ada storage gap** | Upgrade dengan **mapping baru terpisah append-only** (`verifiedHuman`, `seasonHistory`, `badges`) — JANGAN mengubah struct `Passport` lama (menggeser layout). Tambahkan `uint256[50] __gap` sekarang sebagai jaring pengaman |
| S3 | Pola EIP-712 untuk `claimDaily` | Pakai cetakan **TrustPassport** (nonce mapping + deadline + `issuedAt` guard, `TrustPassport.sol:47,92-107`) — lebih cocok daripada pola sessionId GameSettlement. Tambah `mapping(address => uint32) lastClaimDay` sesuai §3.1 |
| S4 | Tidak ada `nonReentrant` di kontrak manapun; TicketShop akan pegang 3 stablecoin (USDT non-standar) | Bangun TicketVault/TicketShop dengan `ReentrancyGuardUpgradeable` + `SafeERC20` sejak awal |
| S5 | `revokePassport` permanen tanpa jalur pemulihan (`TrustPassport.sol:114-122`) | Tambah `unrevokePassport` di upgrade V2 (kesalahan revoke = user hilang permanen) |
| S6 | `FIXED_STAKE_AMOUNT = 100` hardcoded (`GameSettlement.sol:21`) terlihat seperti placeholder | Verifikasi bukan debug leftover; pastikan tidak ada sesi baru start dengan asumsi lama setelah cutover |
| S7 | Owner semua kontrak = single `OwnableUpgradeable`; `_authorizeUpgrade` bisa ganti seluruh logic sepihak | Pindahkan ownership produksi ke multisig sebelum V2 pegang dana tiket |
| S8 | Tidak ada test invariant untuk drift counter GameVault (`totalAvailable/Locked/treasury`) | Tambah fuzz/invariant test sebelum mereplikasi pola akunting yang sama di TicketVault |

### 13.3 🟠 Backend (`backend/`)

Kondisi umum: infrastruktur signing matang dan reusable, tapi **semua konsep V2 (tiket, poin, divisi, season) belum ada satu pun** — dan ada kerapuhan operasional.

| # | Temuan | Solusi |
|---|---|---|
| B1 | Session, SIWE nonce, dan game state aktif semuanya **in-memory Map** (`sessionStore.ts`, `gameState.ts:25-26`) — restart = semua user logout + match orphan; menghalangi multi-instance | Migrasi ke Redis/Supabase. Prioritas naik setelah listing MiniPay (traffic spike = pertama tumbang di sini) |
| B2 | Tidak ada infrastruktur cron/job sama sekali (hanya 2 `setInterval`) — season reset §8 tidak punya tempat menempel | Bangun `services/seasonScheduler.ts` (pola start seperti `startRecoveryWorker()` di `index.ts:96`): polling per menit terhadap `seasons.next_reset_at` di DB (idempotent terhadap restart), atau `node-cron` |
| B3 | Tidak ada skema DB untuk V2 | Buat tabel: `ticket_balances`, `daily_streaks`, `seasons`, `season_points`, `divisions` |
| B4 | Flow match terikat stake USDC on-chain (`routes/game.ts:807-845`, `gameGateway.ts`, `settlementExecutor.ts`) | Rewiring ke debit-1-tiket off-chain: `/start-session` cek+debit `ticket_balances`, hasil match → poin (rumus CP §5.1, pola hitung checkpoint sudah ada di `routes/passport.ts:327-343`), settlement USDC per match dihapus |
| B5 | `signDailyClaim` belum ada | Copy pola `signPassportClaim` (`lib/celo.ts:433-461`): domain + `signTypedData` + nonce `randomBytes(32)` + TTL env baru `DAILY_CLAIM_SIGNATURE_TTL_SECONDS` |
| B6 | `blockchainListener` belum kenal event tiket | Tambah `watchContractEvent` untuk `TicketClaimed/TicketCredited/TicketSpent/TicketPurchased` → update mirror `ticket_balances` + tulis `transactions` (pola sudah ada, straightforward) |
| B7 | Duplikasi `TIER_RULES`/logic tier di `routes/leaderboard.ts:8-62` dan `routes/passport.ts:117-145` | Ekstrak ke modul bersama SEBELUM menambah kompleksitas divisi |
| B8 | Leaderboard sekarang murni statistik kumulatif — tanpa poin/divisi/season/tie-breaker | Tulis query baru di atas tabel B3; pola route + fallback query existing bisa dipakai ulang |
| B9 | `dist/` menumpuk artefak basi (file solana, folder `service/` lama) karena `tsc` tanpa clean | Tambah `"prebuild": "rm -rf dist"` di `package.json` |
| B10 | Dependency pakai `^` range, tidak ada `.npmrc` `ignore-scripts=true` | Pin versi exact + `.npmrc` (syarat §11) |

### 13.4 🟠 Frontend (`frontend/`)

Kondisi umum: **dua syarat MiniPay terberat sudah lolos** (auto-connect benar; login MiniPay tanpa signature via `/auth/minipay`, `WalletProvider.tsx:335-346`). Sisanya: perbaikan kecil listing + satu utang teknis besar.

| # | Temuan | Solusi |
|---|---|---|
| F1 | Tombol LOGIN masih ter-render sekilas saat deteksi MiniPay belum selesai (`HomePage.tsx:822-830`) — reviewer bisa flag | Saat `isMiniPay` terdeteksi tapi account belum sinkron: tampilkan skeleton/loading, bukan CTA connect |
| F2 | **Three.js dimuat dari CDN `https://esm.sh/three`** (`public/script.js:1`) — dependensi eksternal untuk engine inti, buruk untuk PageSpeed, wajib masuk network manifest | Bundle via npm (`three` sebagai dependency), hapus import CDN |
| F3 | Google Fonts via `@import` CSS (`globals.css:1`) — render-blocking, menjatuhkan PageSpeed | Ganti ke `next/font` (self-hosted, non-blocking) |
| F4 | **Belum ada deeplink Add Cash MiniPay** saat saldo kurang (`useBackendDepositFlow.ts:244-250` hanya pesan teks) | Implementasikan deeplink resmi Add Cash — syarat §11 dan §4.2 |
| F5 | Metadata/OG/miniAppEmbed masih hardcode `passchick.vercel.app` (`layout.tsx:7`, `appKit.ts:25`) padahal domain produksi `passchick.xyz` | Sinkronkan APP_URL ke `passchick.xyz` |
| F6 | Dependency `^` range + tidak ada `.npmrc` (lockfile sudah ter-commit — bagus) | Pin exact + `ignore-scripts=true` (syarat §11) |
| F7 | **Utang teknis terbesar:** game engine = vanilla JS 6.317 baris (`public/script.js`) berkomunikasi via `window.__CHICKEN_GAME_BRIDGE__`; logic stake menempel di 3 lapis (`script.js` DEFAULT_STAKE dkk baris 34-36, `GameBridgeClient.tsx:668-706`, `ManageMoneyPage`) | Migrasi stake→tiket dikerjakan sebagai epic terpisah, sentuh ketiga lapis sekaligus dalam satu PR besar dengan test manual penuh — jangan dicicil parsial (bridge contract-nya rapuh) |
| F8 | Layar V2 yang benar-benar baru: daily claim 7 hari, token-selector top-up, countdown season | Reuse pola signed-tx dari `claimPassport` (`GameBridgeClient.tsx:811-833`) untuk daily claim; adaptasi `ManageMoneyPage` untuk top-up; modal Trust Passport existing (`HomePage.tsx:1415-1613`) sudah pas untuk diperluas jadi kanvas karir §7 |
| F9 | Network manifest §11 harus disusun manual | Daftar teridentifikasi: `esm.sh` (hapus via F2), `fonts.googleapis.com` (hapus via F3), backend API + Socket.IO domain, `passchick.gitbook.io`, `t.me/passchick_support` |
| F10 | Minor: `userScalable: false` (potensi flag aksesibilitas), polling vault 1,5 detik terlalu agresif untuk mobile, komentar sampah "celo: dev index" di `layout.tsx:98-124`, Remotion membebani dependency produksi | Evaluasi/dokumentasikan lock-zoom; longgarkan polling; bersihkan komentar; pindahkan Remotion keluar dependency graph produksi |

---

## 14. Roadmap Eksekusi (urutan dependensi)

**Fase 0 — Keamanan & listing blocker (kecil, kerjakan sekarang):**
1. Patch lubang auth §13.1-A + rate-limit
2. Paket listing frontend: F2 (Three.js npm), F3 (next/font), F4 (Add Cash deeplink), F5 (domain), F6+B10 (pinning/.npmrc), F1 (skeleton login)
3. B/C §13.1: `requireEnv` private key, guard faucet mainnet

**Fase 1 — Fondasi V2:**
4. Kontrak `TicketVault`/`TicketShop` (S3, S4) + upgrade TrustPassport (S2, S5) + test invariant (S8)
5. Skema DB (B3) + `signDailyClaim` (B5) + listener event tiket (B6) + `seasonScheduler` (B2) + ekstrak tier logic (B7)

**Fase 2 — Migrasi gameplay:**
6. Rewiring backend stake→tiket (B4)
7. Epic frontend 3-lapis (F7) + layar baru (F8) + leaderboard divisi (B8)

**Fase 3 — Cutover produksi & submit (§10 + S1 + §11.1):**
8. Matikan deposit di UI → tunggu sesi V1 habis → pause GameVault → aktifkan convert-bonus 10%
9. Jalankan checklist hari-H §11.1 (revisi ToS/Privacy, test di container MiniPay, ukur PageSpeed, sample tx kontrak V2, aset form, SLA) → **submit listing**

**Fase 4 — Hardening pasca-launch:**
10. Session store ke Redis/Supabase (B1), multisig owner kontrak (S7), sisanya §13 prioritas rendah (B9, F10)

---

## Lampiran: Draft Pengumuman untuk Pemain

> 🚀 **PassChick Update 2.0: Era Baru Push Rank, Tiket & Sistem Poin!**
>
> - 🎟️ **Main pakai Tiket** — bye-bye taruhan USDC! 1 match = 1 tiket. Main lebih fun, aman, dan fokus ke skill.
> - 🎁 **Tiket gratis tiap hari** — daily login reward dengan Mystery Box, plus top-up cepat pakai USDT/USDC/cUSD ($1 = 20 tiket).
> - 🏆 **5 Divisi: Rookie → Runner → Steady → Elite → Oracle** — semua mulai dari Rookie. Push rank tiap season (2 minggu) untuk promosi, hadiah, dan skin eksklusif!
> - 👑 **Oracle Top 5** memperebutkan Grand Prize CELO + royalty dari revenue season!
> - 🛂 **Passport-mu = kartu karirmu** — skin, badge, dan gelar season menempel permanen. Pamerkan tier-mu!
> - 💰 **Saldo lama?** Withdraw kapan saja, atau convert ke tiket dengan bonus 10% (30 hari pertama).
> - 🎫 Tiket **tidak hangus** saat season reset — tabung untuk push rank season depan!
