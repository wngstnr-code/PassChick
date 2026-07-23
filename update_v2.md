# PassChick v2.0 — Spesifikasi Lengkap

**Status:** Draft final untuk implementasi
**Target:** Submit listing Mini App di MiniPay
**Terakhir diupdate:** 2026-07-22 (revisi setelah verifikasi state on-chain — lihat §15)

---

## 1. Ringkasan & Tujuan

PassChick v2 mengganti model *stake USDC per match* menjadi model **Tiket + Leaderboard musiman**. Alasan utama:

1. **Kelayakan listing MiniPay.** Model "taruh USDC, kalah = hangus" terbaca sebagai real-money gambling oleh reviewer (MiniPay didistribusikan via Google Play/Opera Mini yang ketat soal ini). Model tiket + kompetisi skill musiman masuk kategori "games" yang didukung.
2. **Retensi.** Daily login, season bulanan, dan sistem divisi memberi alasan user kembali setiap hari.
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
| Perk passport | +1 tiket daily untuk tier tertentu (lihat §7) | ✅ (menempel di daily claim) |

> Konversi saldo GameVault lama **dihapus** dari desain — total saldo user di mainnet cuma $0.0187, tidak sepadan dibangun. Lihat §10.

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
- ⚠️ **Reward moneter Season 1 butuh funding eksternal.** `treasuryBalance` on-chain saat ini **$0.1133** (§15) — tidak menutupi satu pun pemenang Elite ($3–5), apalagi grand prize Oracle. Dua opsi: (a) top-up treasury dari kantong sendiri sebelum S1, atau (b) Season 1 jalan **reward non-moneter saja** (tiket + skin + badge) dan reward uang baru aktif di S2 setelah revenue top-up masuk. Rekomendasi: **(b)** — nol modal, dan royalty Oracle memang self-funding dari revenue season berjalan sehingga otomatis bekerja begitu ada pembeli tiket.

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

> ⚠️ **Bertabrakan dengan kenyataan on-chain — lihat S9.** Passport punya `expiry` ~30 hari, dan per 2026-07-22 **seluruh passport pemain di mainnet sudah kedaluwarsa**. "Permanen selamanya" di bawah ini belum benar sampai model expiry-nya diputuskan.

- Skin, badge season, gelar Oracle — semua menempel di passport dan tampil di leaderboard & profil.
- Riwayat divisi per season tercatat on-chain (event/mapping di kontrak passport) — "pernah Oracle di S1" permanen selamanya.
- Passport = trophy cabinet yang tidak mau ditinggalkan user.

---

## 8. Sistem Season

- Durasi: **1 bulan (kalender)**. *(Direvisi 2026-07-22 — semula 2 minggu; keputusan produk, sudah terimplementasi di backend.)*
- Reset otomatis setiap **tanggal 1 pukul 07:00 WIB (00:00 UTC)** — timezone dikunci WIB, ditampilkan di UI sebagai countdown (bukan jam absolut) agar tidak ambigu bagi user global. Season pertama: jika bootstrap terjadi < 7 hari sebelum tanggal 1, reset digeser ke tanggal 1 bulan berikutnya lagi (mencegah season perdana yang cuma beberapa hari).
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

- **TrustPassport** — **di-upgrade** (tier lintas season, status verified Self.xyz, badge/gelar). Sudah UUPS.
- **GameSettlement** — **dormant.** Di V2 satu match = satu tiket yang didebit off-chain, jadi tidak ada lagi yang perlu di-settle on-chain. Kontraknya tetap live (proxy tidak bisa dihapus) tapi tidak dipanggil lagi setelah cutover. Pola EIP-712-nya tidak dipakai ulang — `claimDaily` mencontek TrustPassport, bukan ini (lihat S3).
- **GameVault** — **dormant**, withdraw-only (lihat §10). Kode tidak diubah: `withdraw()` sudah tanpa `whenNotPaused`, jadi `pause()` otomatis menghasilkan withdraw-only.

> Total kontrak mainnet: **3 → 4**. Tidak ada yang dihapus (proxy yang pegang dana user harus tetap hidup selamanya agar withdraw jalan). `GameUSDC` + `USDCFaucet` tetap testnet-only.

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

**Direvisi 2026-07-22.** Rencana awal (fitur convert-ke-tiket + bonus 10% + banner + deadline 30 hari) **dibatalkan**. Alasannya angka on-chain: total `availableBalances` seluruh pemain = **$0.0187** (§15). Bonus 10% dari itu bernilai $0.0019. Membangun flow konversi on-chain untuk melindungi dua sen adalah scope yang tidak akan pernah balik modal — dan setiap fitur ekstra menambah permukaan yang harus dijelaskan ke reviewer MiniPay.

### 10.1 Kendala keras: refund manual TIDAK MUNGKIN

Rencana pengganti berupa "kirim balik dana user secara manual" juga **tidak bisa dieksekusi** — kontraknya tidak menyediakan jalurnya, dan itu memang desain yang benar:

- Tidak ada fungsi owner yang memindahkan `availableBalances`. Satu-satunya jalan keluar adalah `withdraw()`, yang mensyaratkan `msg.sender` = pemilik saldo (`GameVault.sol:94-109`).
- `rescueToken` sengaja mengecualikan dana user (`GameVault.sol:152`):
  ```
  rescuable = actualBalance − (totalAvailable + totalLocked + treasury)
            = 133,300 − 133,300 = 0
  ```
  Owner bisa menyelamatkan **persis nol**.

**Konsekuensi:** menghapus tombol withdraw = penyitaan de facto. Dana user terkunci permanen karena tidak ada satu pun pihak yang bisa mengeluarkannya. Tombol withdraw **wajib tetap ada di V2**, tanpa kecuali.

### 10.2 Rencana final

1. **Deposit dimatikan di UI** saat v2 rilis; mode `deposit` di `ManageMoneyPage.tsx` dialihfungsikan jadi top-up tiket (§13.4-F8).
2. **Withdraw tetap ada, tapi turun pangkat — bukan dihapus.** Render tab withdraw secara kondisional, hanya kalau `availableBalanceOf(user) > 0`:
   ```tsx
   const moneyModes = [
     { mode: "deposit", label: "TOP UP" },
     ...(legacyBalance > 0n ? [{ mode: "withdraw", label: "WITHDRAW" }] : []),
   ];
   ```
   User V2 baru saldonya nol → tidak pernah melihat tab ini sama sekali, UI bersih dan konsep "vault USDC" hilang dari pandangan reviewer MiniPay. User lama tetap punya pintu keluar otomatis tanpa perlu dilacak satu per satu. Begitu mereka tarik, tabnya hilang sendiri selamanya.
3. **Tidak ada deadline, tidak ada force-convert.** `withdraw()` jalan terus bahkan setelah kontrak di-`pause()` (fungsinya tanpa `whenNotPaused`).

⚠️ **Jangan** hapus withdraw path di `useBackendDepositFlow`, dan jangan pensiunkan alamat `GameVault` dari config frontend. Kontraknya harus tetap terhubung meski tabnya tersembunyi.

### 10.3 Sesi V1 yang menggantung

`totalLockedBalance = 1300` = 13 sesi × `FIXED_STAKE_AMOUNT` (100), total **$0.0013**. Perlu didrain sebelum `pause()` (§14 Fase 3), tapi perhatikan: **`expireSession` bukan refund.** Baris `GameSettlement.sol:236` memanggil `vault.settleCrash(...)` — stake masuk **treasury**, pemain dianggap kalah. Refund sungguhan butuh `settleWithSignature` dengan `payout = stake` bertanda tangan backend signer.

Keputusan: **pakai `expireSession`** (sita ke treasury). Membangun flow refund bertanda tangan untuk $0.0013 tidak sepadan. `sessionExpiryDelay = 86400` dan sesi-sesi ini sudah jauh lewat, jadi langsung eligible.

`sessionId`-nya ada di Supabase `game_sessions.onchain_session_id` — `recoveryWorker.ts` hanya menangani status `CRASHED`/`CASHED_OUT`, bukan yang menggantung, jadi perlu query manual + cocokkan dengan `getSession()` on-chain.

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
| S1 | 🔴 **Jebakan cutover — SUDAH TERJADI, bukan hipotetis.** `pause()` GameVault memblokir deposit SEKALIGUS `lockStake`/`settleCashout`/`settleCrash` (`GameVault.sol:82,166,187,213`). Verifikasi on-chain 2026-07-22: **`totalLockedBalance = 1300`** (= 13 sesi × `FIXED_STAKE_AMOUNT` 100) masih nyangkut sekarang juga. Pause hari ini = dana itu terkunci permanen — `rescueToken` pun mengecualikan `totalLockedBalance` (`GameVault.sol:152`), jadi owner tidak bisa menyelamatkan | `expireSession()` (`GameSettlement.sol:218`) **permissionless** — siapa pun bisa panggil, tidak perlu owner. Tapi dia `whenNotPaused`, jadi harus dieksekusi SEBELUM pause. Urutan wajib: matikan deposit di UI → drain 13 sesi via `expireSession` → **verifikasi `totalLockedBalance == 0` on-chain** → baru `pause()`. Jadikan pengecekan nol ini gate eksplisit di runbook, bukan asumsi |
| S2 | TrustPassport belum punya field untuk verified/badge/riwayat season, dan **tidak ada storage gap** | Upgrade dengan **mapping baru terpisah append-only** (`verifiedHuman`, `seasonHistory`, `badges`) — JANGAN mengubah struct `Passport` lama (menggeser layout). Tambahkan `uint256[50] __gap` sekarang sebagai jaring pengaman |
| S3 | Pola EIP-712 untuk `claimDaily` | Pakai cetakan **TrustPassport** (nonce mapping + deadline + `issuedAt` guard, `TrustPassport.sol:47,92-107`) — lebih cocok daripada pola sessionId GameSettlement. Tambah `mapping(address => uint32) lastClaimDay` sesuai §3.1 |
| S4 | Tidak ada `nonReentrant` di kontrak manapun; TicketShop akan pegang 3 stablecoin (USDT non-standar) | Bangun TicketVault/TicketShop dengan `ReentrancyGuardUpgradeable` + `SafeERC20` sejak awal |
| S5 | `revokePassport` permanen tanpa jalur pemulihan (`TrustPassport.sol:114-122`) | Tambah `unrevokePassport` di upgrade V2 (kesalahan revoke = user hilang permanen) |
| S6 | ✅ **Terjawab.** `FIXED_STAKE_AMOUNT = 100` (`GameSettlement.sol:21`) bukan debug leftover — itu memang nilai produksi, dan dengan USDC 6 desimal artinya stake riil **$0.0001 per match** (seperseratus sen) | Tidak ada aksi kode. Tapi catat implikasinya: V1 secara ekonomi adalah **demo**, bukan game uang sungguhan. Menguntungkan saat framing ke reviewer MiniPay ("belum pernah ada taruhan bernilai"), tapi **jangan** dipakai sebagai klaim traksi real-money di aplikasi grant |
| S7 | ⏸️ **DITUNDA — keputusan sadar 2026-07-22.** Owner ketiga kontrak = EOA tunggal `0x5739…3cFB9`, dan private key-nya kini tersimpan plaintext di `sc/.env`. Kunci itu bisa `upgradeToAndCall` ketiganya, `setTreasury`, `creditBatch`, dan `treasuryWithdraw` — setara kepemilikan penuh | **Pemicu wajib: sebelum `setToken` dipanggil di mainnet** (lihat §14 Fase 1b). Bukan sebelum deploy. Alasan penundaan: hari ini kunci itu menjaga $0.13, jadi gesekan multisig belum sepadan. Opsi minimum yang tetap menutup risiko terbesar (kunci plaintext) tanpa memperlambat operasi: hardware wallet + `forge --ledger`/keystore terenkripsi, tanpa multisig. Risiko sisa selama ditunda: kunci bocor bisa meng-upgrade GameVault dan mengambil $0.0187 milik pemain lama atau merusak kontrak — nominalnya remeh, tapi kalau terjadi saat review MiniPay berjalan, biaya listing-nya jauh lebih mahal |
| S9 | 🆕 **Passport punya masa kedaluwarsa — bertabrakan dengan §7.3 "identitas karir permanen".** Ditemukan 2026-07-22 saat memverifikasi upgrade mainnet: keempat passport pemain asli yang dicek sudah **kedaluwarsa**, `expiry ≈ 1784522409` (18 Juli) sementara tanggal cek 22 Juli, sehingga `isPassportValid` mengembalikan `false` untuk semuanya. Bukan efek upgrade — kondisinya sudah begitu sebelum kontrak disentuh. Artinya passport berlaku ~30 hari dan tidak ada mekanisme perpanjangan otomatis | Perlu keputusan desain sebelum §7 dibangun. §7.3 menjanjikan gelar Oracle "permanen selamanya" dan passport sebagai *trophy cabinet* — mustahil kalau passport-nya mati sebulan sekali. Tiga opsi: (a) backend menandatangani ulang passport otomatis saat user login (paling kecil perubahannya, `claimWithSignature` sudah mendukung karena `issuedAt` yang lebih baru diterima), (b) pisahkan "identitas permanen" dari "kredensial berjangka" — badge/gelar/`seasonHistory` tidak pernah kedaluwarsa, hanya `tier` yang perlu refresh, (c) hilangkan expiry lewat upgrade. Rekomendasi: **(b)** — kebetulan storage V2 sudah begitu bentuknya, `badges` dan `seasonHistory` tidak mengenal expiry sama sekali, jadi tinggal memastikan gate reward tidak ikut membaca `isPassportValid` secara buta. **Catatan: `canClaimMonetaryReward` saat ini MEMBACA expiry** — dengan kondisi sekarang, tidak ada satu pun pemain yang bisa mencairkan reward uang. **KEPUTUSAN 2026-07-23: opsi (b) diambil** — detail & pembagian kerja di `docs/s9-passport-decision.md` |
| S8 | ⬇️ **Turun prioritas.** Verifikasi on-chain: `18740 + 1300 + 113260 = 133300` = saldo USDC riil kontrak, **drift nol**. Pola akuntingnya terbukti benar di produksi | Fuzz/invariant test tetap layak ditulis untuk TicketVault, tapi **bukan blocker** — polanya sudah tervalidasi oleh data, aman direplikasi |

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
| F8 | Layar V2 yang benar-benar baru: daily claim 7 hari, token-selector top-up, countdown season | Reuse pola signed-tx dari `claimPassport` (`GameBridgeClient.tsx:811-833`) untuk daily claim; adaptasi `ManageMoneyPage` untuk top-up — mode `deposit` jadi TOP UP, mode `withdraw` **dipertahankan** tapi conditional-render (§10.2, jangan dihapus); modal Trust Passport existing (`HomePage.tsx:1415-1613`) sudah pas untuk diperluas jadi kanvas karir §7 |
| F9 | Network manifest §11 harus disusun manual | Daftar teridentifikasi: `esm.sh` (hapus via F2), `fonts.googleapis.com` (hapus via F3), backend API + Socket.IO domain, `passchick.gitbook.io`, `t.me/passchick_support` |
| F10 | Minor: `userScalable: false` (potensi flag aksesibilitas), polling vault 1,5 detik terlalu agresif untuk mobile, komentar sampah "celo: dev index" di `layout.tsx:98-124`, Remotion membebani dependency produksi | Evaluasi/dokumentasikan lock-zoom; longgarkan polling; bersihkan komentar; pindahkan Remotion keluar dependency graph produksi |

---

## 14. Roadmap Eksekusi (urutan dependensi)

**Fase 0 — Keamanan & listing blocker (kecil, kerjakan sekarang):**
1. Patch lubang auth §13.1-A + rate-limit
2. Paket listing frontend: F2 (Three.js npm), F3 (next/font), F4 (Add Cash deeplink), F5 (domain), F6+B10 (pinning/.npmrc), F1 (skeleton login)
3. B/C §13.1: `requireEnv` private key, guard faucet mainnet

**Fase 1 — Fondasi V2:**

4. ✅ **SELESAI 2026-07-22 — kontrak.** `TicketVault` (S3, S4 — TicketShop digabung di dalamnya) + upgrade TrustPassport (S2, S5) + fuzz invariant (S8). 103 test lulus. Terdeploy & terverifikasi `exact_match` di Celo Sepolia:

   ```
   TicketVault proxy      0x1490e6B836f552e8504fE6404C30953B15F899c8
   TicketVault impl       0x6C131a955d24AAC1E978558e94D733c5dD967137
   TrustPassport proxy    0xF8Bc8B497Cbb7D08a14Ba2107F2C521c78B0eC38  (di-upgrade)
   TrustPassport impl V2  0x034caEB4a9bbfDDAe9C07FE897f6ec37F40609ea
   ```

   Terbukti di chain, bukan hanya di test: `claimDaily` dengan tanda tangan backend asli (`0x9579b27a…`), `buyTickets` $3 → 60 tiket dengan vault memegang 0 stablecoin (`0xe9f8c2f6…`), `spendBatch`, upgrade passport tanpa menggeser `owner`/`backendSigner`, serta guard `DayAlreadyClaimed` (diuji dengan nonce baru, jadi yang menolak memang `lastClaimDay`) dan `TicketAmountTooLarge`.

   Tambahan di luar draft awal: cap `MAX_TICKETS_PER_CLAIM = 100` (membatasi kerusakan kalau signer bocor), `rescueToken`, dan `setToken` memverifikasi desimal ke `IERC20Metadata.decimals()` alih-alih mempercayai input manual.

5. Skema DB (B3) + `signDailyClaim` (B5) + listener event tiket (B6) + `seasonScheduler` (B2) + ekstrak tier logic (B7)

**Fase 1b — Deploy mainnet bertahap (toko tutup dulu):**

Deploy TicketVault ke mainnet **tanpa memanggil `setToken` sama sekali**. `buyTickets` menolak token yang tidak di-whitelist (`TokenNotEnabled`), jadi jalur uangnya mati total sementara `claimDaily`, `creditBatch`, dan seluruh integrasi backend tetap jalan. Konsekuensinya: selama fase ini **nol uang berisiko**, sehingga S7 boleh tetap tertunda.

```
deploy mainnet, TANPA setToken   → backend integrasi penuh, daily claim hidup
   ↓
amankan kunci owner (S7)          → hardware wallet minimum
   ↓
setToken di mainnet              → toko tiket buka, uang mulai masuk
```

Garis `setToken` itu batasnya. Sebelum dilewati, kunci plaintext tidak menjaga uang siapa pun; sesudahnya, dia menjaga uang pengguna.

**✅ Dieksekusi 2026-07-22 — Celo Mainnet (42220):**

```
TicketVault proxy   0x8a1bd73DDFb4E06779D9c578a6447aE9B48199D5
TicketVault impl    0xAC5574EC54bAf71A855F9Fc5989F51f555965F71   verified di Celoscan
```

Status terverifikasi on-chain setelah deploy:

| Item | Nilai |
|---|---|
| owner / treasury | `0x57394581…3cFB9` (konsisten dengan kontrak mainnet lain) |
| backendSigner | `0xCa9298971140d120F010D5901DeC4f297C72c7Da` |
| `claimSignatureTtl` | 600 detik |
| `MAX_TICKETS_PER_CLAIM` | 100 |
| USDC / USDT / cUSD | **`enabled = false` ketiganya** |
| `buyTickets(USDC, $1)` | revert `0xd334e6bd` (`TokenNotEnabled`) ✅ |

> ⚠️ **Jebakan saat deploy — wajib diulang kalau redeploy.** `sc/.env` berisi `USDC_ADDRESS` yang terisi. Kalau script dijalankan dengan `source .env` biasa, `_configureTokens` akan meng-whitelist USDC dan **toko langsung buka**. Ketiga variabel token harus ditimpa kosong secara eksplisit:
>
> ```bash
> USDC_ADDRESS= USDT_ADDRESS= CUSD_ADDRESS= forge script ... --sig "run()"
> ```
>
> Verifikasi sebelum broadcast: jalankan simulasi lebih dulu dan pastikan `broadcast/.../dry-run/run-latest.json` hanya berisi **2 transaksi CREATE** dan nol `setToken`.

**✅ TrustPassport mainnet di-upgrade ke V2 — 2026-07-22.**

```
TrustPassport proxy   0x4Bf6D3C0dBbC14eF0C7f2a4daeD7D97418Fc5aDf
impl lama             0x974743364164dfb8d8802ef9192db0f0d9c57b27
impl baru             0x124a8B9C2e4549a4854c0EF8336827D03b49ce0D   verified di Celoscan
```

Bukti data pemain selamat — dicek dengan **passport 4 alamat sungguhan** (didapat dari Blockscout, bukan alamat uji), terbaca byte-identik sebelum dan sesudah upgrade:

```
0x065Ba780 : (tier 1, issuedAt 1781930409, expiry 1784522409, revoked false)
0x17d53D8c : (tier 1, issuedAt 1781930393, expiry 1784522393, revoked false)
0x191F3C7a : (tier 1, issuedAt 1781930369, expiry 1784522369, revoked false)
0x31504D05 : (tier 1, issuedAt 1781930406, expiry 1784522406, revoked false)
```

`owner` dan `backendSigner` tidak bergeser; `verifiedHuman`/`badges`/`seasonHistory` lahir kosong, bukan hasil salah-baca byte V1.

Perintah yang dipakai (`TRUST_PASSPORT_ADDRESS` di `.env` sudah menunjuk proxy mainnet, jadi **tidak** ditimpa — kebalikan dari saat menjalankannya untuk Sepolia, yang wajib ditimpa ke `0xF8Bc8B49…`):

```bash
PRIVATE_KEY="$WALLET_DEPLOYER_PRIVATE_KEY" \
forge script script/DeployV2Contracts.s.sol:DeployV2Contracts --sig "upgradePassport()" \
  --rpc-url https://forno.celo.org --broadcast
```

**Fase 2 — Migrasi gameplay:**
6. Rewiring backend stake→tiket (B4)
7. Epic frontend 3-lapis (F7) + layar baru (F8) + leaderboard divisi (B8)

**Fase 3 — Cutover produksi & submit (§10 + S1 + §11.1):**
8. Runbook cutover, urutannya mengikat:
   a. Matikan deposit di UI
   b. Drain sesi nyangkut: panggil `expireSession()` untuk 13 sesi terbuka (permissionless, tapi harus sebelum pause)
   c. **Gate: verifikasi `cast call $VAULT "totalLockedBalance()(uint256)"` mengembalikan `0`** — jangan lanjut kalau bukan nol
   d. `pause()` GameVault → withdraw-only otomatis aktif
   e. **Jangan** sentuh saldo user tersisa — tidak ada jalur owner untuk itu (§10.1). Cukup pastikan tab withdraw conditional-render sudah live (§10.2) agar user bisa tarik sendiri kapan pun
9. Jalankan checklist hari-H §11.1 (revisi ToS/Privacy, test di container MiniPay, ukur PageSpeed, sample tx kontrak V2, aset form, SLA) → **submit listing**

**Fase 4 — Hardening pasca-launch:**
10. Session store ke Redis/Supabase (B1), sisanya §13 prioritas rendah (B9, F10)

> **Utang yang sengaja ditinggalkan — jangan sampai hilang dari ingatan:**
> 1. **S7 (kunci owner)** — pemicunya `setToken` di mainnet, lihat Fase 1b.
> 2. **Kontrak pembayar reward uang belum ada.** §9.2 menjanjikan "reward uang claimable on-chain" dan §7.1 gerbangnya sudah dibangun (`canClaimMonetaryReward`), tapi tidak ada kontrak yang benar-benar mencairkan stablecoin/CELO ke pemenang divisi. Ini konsekuensi keputusan Season 1 non-moneter (§6), jadi tidak memblokir listing — tapi **harus ada sebelum season pertama yang berhadiah uang berakhir**, bukan saat pemenangnya sudah menagih.

---

## 15. Verifikasi State On-Chain (2026-07-22)

Semua revisi di dokumen ini berdasar data berikut, dibaca langsung dari Celo Mainnet (chain 42220) via forno.

```
GameVault      0x8FB74c2a678811aECC6Ed98Bd5Bc70E1119b7B61
GameSettlement 0x29b5333E2fbd4de48BD5fe14b3972d6Af24aa01E
TrustPassport  0x4Bf6D3C0dBbC14eF0C7f2a4daeD7D97418Fc5aDf
USDC           0xcebA9300f2b948710d2653dD7B07f33A8B32118C  (6 desimal)

totalAvailableBalance     18,740  = $0.018740   ← saldo SEMUA user digabung
totalLockedBalance         1,300  = $0.001300   ← 13 sesi nyangkut (S1)
treasuryBalance          113,260  = $0.113260
                         -------
                         133,300
USDC riil dipegang vault  133,300               ✅ invariant utuh, drift nol

paused: vault=false, settlement=false, passport=false
owner (ketiganya): 0x57394581E832cD31EE0233618c58035033D3cFB9 → EOA, saldo 0.249 CELO
backendSigner:     0xCa9298971140d120F010D5901DeC4f297C72c7Da → beda dari owner ✅
vault.settlement ↔ settlement.vault: saling terpasang benar ✅
```

Cara reproduksi:

```bash
R=https://forno.celo.org
V=0x8FB74c2a678811aECC6Ed98Bd5Bc70E1119b7B61
cast call $V "totalAvailableBalance()(uint256)" --rpc-url $R
cast call $V "totalLockedBalance()(uint256)"    --rpc-url $R
cast call $V "treasuryBalance()(uint256)"       --rpc-url $R
cast call $V "paused()(bool)"                   --rpc-url $R
```

**Batasan pengukuran — jangan diperlakukan sebagai data lengkap:** volume historis **belum terukur**. Forno membatasi `eth_getLogs` di 5.000 blok per query, dan sampling yang dilakukan hanya 3 jendela selebar ~83 menit (semuanya nol event) — terlalu sempit untuk menyimpulkan apa pun soal tingkat aktivitas. Angka lifetime (jumlah deposit, match, user unik) **masih perlu diambil** lewat RPC archive atau Celoscan API sebelum dipakai di aplikasi grant atau form listing.

---

## Lampiran: Draft Pengumuman untuk Pemain

> 🚀 **PassChick Update 2.0: Era Baru Push Rank, Tiket & Sistem Poin!**
>
> - 🎟️ **Main pakai Tiket** — bye-bye taruhan USDC! 1 match = 1 tiket. Main lebih fun, aman, dan fokus ke skill.
> - 🎁 **Tiket gratis tiap hari** — daily login reward dengan Mystery Box, plus top-up cepat pakai USDT/USDC/cUSD ($1 = 20 tiket).
> - 🏆 **5 Divisi: Rookie → Runner → Steady → Elite → Oracle** — semua mulai dari Rookie. Push rank tiap season (1 bulan) untuk promosi, hadiah, dan skin eksklusif!
> - 👑 **Oracle Top 5** memperebutkan Grand Prize CELO + royalty dari revenue season!
> - 🛂 **Passport-mu = kartu karirmu** — skin, badge, dan gelar season menempel permanen. Pamerkan tier-mu!
> - 💰 **Saldo lama?** Withdraw kapan saja, tanpa batas waktu. Dana kamu tetap milik kamu.
> - 🎫 Tiket **tidak hangus** saat season reset — tabung untuk push rank season depan!
