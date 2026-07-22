# PassChick V2 — Handoff ke Backend & Frontend

**Untuk:** tim backend & frontend
**Dari:** sisi smart contract
**Tanggal:** 2026-07-22
**Referensi lengkap:** [`update_v2.md`](./update_v2.md) — dokumen ini hanya bagian yang perlu kalian kerjakan.

---

## 0. Baca ini dulu

Kontrak V2 **sudah live dan terverifikasi di Celo Mainnet**. Kalian tidak perlu menunggu apa pun dari sisi kontrak untuk mulai. Semua fungsi user-facing sudah diuji langsung di chain, bukan hanya di unit test.

Satu hal yang wajib dipahami sebelum menyentuh apa pun:

> ⚠️ **Toko tiket di mainnet sengaja TERTUTUP.** `setToken` belum pernah dipanggil, jadi `buyTickets` selalu revert `TokenNotEnabled` untuk semua stablecoin. Ini disengaja: jalur uang baru dibuka tepat sebelum fitur top-up dirilis, bukan sebelumnya. **Kembangkan & tes fitur top-up di Sepolia**, di mana tokonya terbuka penuh dan mock USDC bisa di-mint bebas.

---

## 1. Alamat kontrak

### Celo Mainnet (chainId `42220`)

| Kontrak | Alamat | Catatan |
|---|---|---|
| `TicketVault` | `0x8a1bd73DDFb4E06779D9c578a6447aE9B48199D5` | toko tertutup, daily claim aktif |
| `TrustPassport` | `0x4Bf6D3C0dBbC14eF0C7f2a4daeD7D97418Fc5aDf` | sudah V2 |
| `GameVault` | `0x8FB74c2a678811aECC6Ed98Bd5Bc70E1119b7B61` | dormant, withdraw-only |
| `GameSettlement` | `0x29b5333E2fbd4de48BD5fe14b3972d6Af24aa01E` | dormant setelah cutover |
| Treasury tiket | `0xEf29d941Be65495631f908EC3211625555D374b9` | penerima revenue `buyTickets` |

Treasury sengaja **beda alamat dari owner**. `TicketVault` meneruskan dana pembelian langsung ke sana dan tidak pernah menyimpan stablecoin sendiri, jadi saldo kontrak selalu nol — kalau kalian melihat stablecoin nyangkut di alamat `TicketVault`, itu salah kirim, bukan alur normal.

### Celo Sepolia (chainId `11142220`) — pakai ini untuk development

| Kontrak | Alamat | Catatan |
|---|---|---|
| `TicketVault` | `0x1490e6B836f552e8504fE6404C30953B15F899c8` | **toko TERBUKA**, USDC mock ter-whitelist |
| `TrustPassport` | `0xF8Bc8B497Cbb7D08a14Ba2107F2C521c78B0eC38` | sudah V2 |
| USDC mock | `0x8FB74c2a678811aECC6Ed98Bd5Bc70E1119b7B61` | 6 desimal, ada `mint()` untuk minter |

Backend signer (kedua jaringan): `0xCa9298971140d120F010D5901DeC4f297C72c7Da` — sama dengan yang sudah dipakai GameSettlement & TrustPassport, jadi tidak ada kunci baru untuk diurus.

ABI ada di `sc/out/TicketVault.sol/TicketVault.json` setelah `forge build`, atau ambil dari Celoscan (kontraknya verified).

> **Selalu pakai alamat proxy di atas, jangan alamat implementasi.** Kontraknya UUPS, jadi implementasi bisa berganti tanpa alamat proxy berubah — dan memang sudah berganti sekali pada 2026-07-22 untuk menambah role `operator`. Kalau kalian hardcode alamat implementasi, integrasi akan diam-diam membaca kontrak lama yang tidak punya state apa pun.

---

## 2. BACKEND

### 2.1 🔴 Yang paling mendesak: lubang autentikasi

**Ini blocker keamanan, bukan fitur.** `POST /auth/social` dan `POST /auth/minipay` (`backend/src/routes/auth.ts:105-201`) menerima `{address, chainId}` mentah lalu langsung membuat session token untuk address itu. Blok validasi di `auth.ts:145-149` **kosong** — tidak pernah menolak apa pun. Siapa pun bisa `curl` dan login sebagai wallet siapa pun (CORS tidak melindungi non-browser).

Di V1 dampaknya terbatas: uang tetap butuh transaksi bertanda tangan dari wallet asli. **Di V2 ini fatal** — tiket didebit off-chain bermodal session token, jadi penyerang bisa menghabiskan tiket pemain lain dan mencemari leaderboard.

MiniPay melarang minta sign-message untuk login, jadi solusinya bukan itu. Prinsip yang harus dipegang:

- **Session token tidak pernah cukup untuk mutasi bernilai.** Klaim daily & reward selalu lewat EIP-712 + transaksi dari wallet user (sudah begitu desainnya).
- **Debit tiket saat main harus dijangkarkan ke saldo on-chain** (mirror dari event), bukan angka bebas di DB.
- Operasi baca (leaderboard, profil) boleh tetap session-based.
- Isi validasi kosong di `auth.ts:145-149` + rate-limit per IP/address di semua endpoint auth.

Selesaikan ini sebelum tiket punya nilai uang.

### 2.2 `signDailyClaim` — yang paling sering dipakai

Satu transaksi per user per hari. Pola persis mengikuti `signPassportClaim` yang sudah ada di `backend/src/lib/celo.ts:433-461`.

**EIP-712 domain:**

```json
{
  "name": "PassChickTicketVault",
  "version": "1",
  "chainId": 42220,
  "verifyingContract": "0x8a1bd73DDFb4E06779D9c578a6447aE9B48199D5"
}
```

**Struct — urutan field WAJIB persis seperti ini:**

```
DailyClaim(address user,uint32 dayIndex,uint16 amount,uint64 issuedAt,uint256 nonce)
```

Typehash hasilnya: `0xc225768d391bfd070c6d6bc101f342363ed5e246957bfbddd5b77516817a3da1`

Cross-check dengan memanggil `DAILY_CLAIM_TYPEHASH()` di kontrak. Kalau tidak sama, ada yang salah ketik di struct string.

**Contoh viem:**

```ts
const signature = await walletClient.signTypedData({
  account: backendSigner,
  domain: {
    name: "PassChickTicketVault",
    version: "1",
    chainId: 42220,
    verifyingContract: TICKET_VAULT_ADDRESS,
  },
  types: {
    DailyClaim: [
      { name: "user",     type: "address" },
      { name: "dayIndex", type: "uint32"  },
      { name: "amount",   type: "uint16"  },
      { name: "issuedAt", type: "uint64"  },
      { name: "nonce",    type: "uint256" },
    ],
  },
  primaryType: "DailyClaim",
  message: { user, dayIndex, amount, issuedAt, nonce },
});
```

**Aturan yang ditegakkan kontrak — signature akan ditolak kalau dilanggar:**

| Aturan | Error kalau gagal |
|---|---|
| `claim.user` harus == pengirim transaksi | `InvalidUser(address)` |
| `amount` > 0 | `ZeroTicketAmount()` |
| `amount` ≤ **100** (`MAX_TICKETS_PER_CLAIM`) | `TicketAmountTooLarge(uint16,uint16)` |
| `issuedAt` tidak boleh di masa depan | `DailyClaimInFuture(uint64)` |
| `block.timestamp` ≤ `issuedAt + claimSignatureTtl` (**600 detik**) | `DailyClaimExpired(uint64,uint64)` |
| `nonce` belum pernah dipakai | `NonceAlreadyUsed(uint256)` |
| `dayIndex` harus **lebih besar** dari `lastClaimDay[user]` | `DayAlreadyClaimed(uint32,uint32)` |

Catatan penting soal dua yang terakhir: `dayIndex` harus **monoton naik**, bukan sekadar berbeda. Guard `lastClaimDay` sengaja terpisah dari nonce supaya klaim ganda per hari tetap ditolak **walau backend tertipu menandatangani dua kali**. Jadi `dayIndex` harus mencerminkan hari sebenarnya (mis. jumlah hari sejak epoch), bukan indeks siklus 1–7 yang berulang. Kalau pakai 1–7 berulang, user tidak akan bisa klaim lagi setelah hari ke-7 selamanya.

TTL 600 detik berarti signature basi setelah 10 menit — jangan di-cache lama di frontend. Env baru yang perlu ditambahkan: `DAILY_CLAIM_SIGNATURE_TTL_SECONDS`.

**Perk passport (+1 tiket untuk tier Veteran+) dan hasil roll mystery box digabung ke dalam `amount` di signature yang sama**, bukan transaksi terpisah.

### 2.3 Listener event

Tambahkan `watchContractEvent` di `backend/src/services/blockchainListener.ts` — pola untuk event lain sudah ada di sana.

| Event | Signature | topic0 |
|---|---|---|
| `TicketClaimed` | `(address indexed user, uint32 indexed dayIndex, uint16 amount, uint256 nonce)` | `0xb530be75…4622c0` |
| `TicketPurchased` | `(address indexed user, address indexed token, uint256 usdAmount, uint256 cost, uint256 tickets)` | `0x073b30de…72bdee` |
| `TicketCredited` | `(address indexed user, uint256 amount)` | `0xe9947732…a7934b` |
| `TicketSpent` | `(address indexed user, uint256 amount)` | `0xbedd45ec…ae092cb` |

Semuanya meng-update mirror `ticket_balances` + menulis ke tabel `transactions`.

> ⚠️ **Forno bukan archive node.** Query `eth_getLogs` dibatasi **5.000 blok** per request, dan state lama dipangkas. Untuk backfill riwayat, jangan andalkan Forno — pakai RPC berbayar (Alchemy/Infura) atau paginasi 5.000 blok dengan checkpoint tersimpan. Untuk listener realtime, Forno cukup.

### 2.4 Skema DB yang perlu dibuat

`ticket_balances`, `daily_streaks`, `seasons`, `season_points`, `divisions`.

`ticket_balances` adalah **mirror dari on-chain**, bukan sumber kebenaran. Saldo asli selalu `TicketVault.ticketBalance(address)`. Kalau mirror dan on-chain berbeda, on-chain yang menang — sediakan cara rekonsiliasi.

### 2.5 Debit tiket saat main

Alur match sekarang terikat stake USDC on-chain (`routes/game.ts:807-845`, `gameGateway.ts`, `settlementExecutor.ts`). Rewiring:

- `/start-session` → cek & debit 1 tiket dari `ticket_balances` (off-chain, harus instan)
- Hasil match → poin sesuai rumus CP di `update_v2.md` §5.1 (pola hitung checkpoint sudah ada di `routes/passport.ts:327-343`)
- Settlement USDC per match **dihapus**
- Pemakaian tiket disettle berkala ke chain lewat `spendBatch(address[], uint256[])` — dipanggil pakai **kunci operator** (lihat §2.7). Batch berkala, bukan per match.

### 2.6 Season scheduler

Belum ada infrastruktur cron sama sekali (hanya 2 `setInterval`). Bangun `services/seasonScheduler.ts` dengan pola start seperti `startRecoveryWorker()` di `index.ts:96` — polling per menit terhadap `seasons.next_reset_at`, idempotent terhadap restart. Urutan proses reset ada di `update_v2.md` §8.

Reward tiket season dikredit lewat `creditBatch(address[], uint256[])` — juga pakai kunci operator (§2.7).

### 2.7 Kunci operator — yang kalian pakai untuk `creditBatch` / `spendBatch`

Kedua fungsi batch itu menciptakan dan menghapus tiket, jadi tidak bisa dibuka untuk umum. Tapi backend perlu memanggilnya otomatis dan berkala, sementara kunci owner tersimpan di keystore terenkripsi yang butuh password diketik manusia — mustahil di server.

Karena itu kontrak punya **role `operator`** terpisah:

```solidity
setOperator(address account, bool allowed)   // onlyOwner
operators(address) returns (bool)            // cek status
```

Kunci operator **hanya** boleh memanggil `creditBatch` dan `spendBatch`. Dia ditolak untuk `setTreasury`, `setToken`, `pause`, `setOperator`, `rescueToken`, dan `upgradeToAndCall` — ada test yang membuktikan keenam-enamnya. Artinya kalau kunci di server produksi bocor, penyerang bisa mengacaukan saldo tiket, tapi **tidak** bisa mengambil alih kontrak, mengalihkan treasury, atau membuka toko.

Yang perlu kalian lakukan:

1. **Generate keypair baru khusus untuk ini.** Jangan pakai `BACKEND_PRIVATE_KEY` yang sudah ada — biarkan peran "menandatangani klaim EIP-712" dan peran "menulis batch akunting" terpisah, supaya satu kunci bocor tidak langsung memberi keduanya.
2. Kirim **alamatnya** (bukan private key-nya) ke sisi kontrak untuk didaftarkan lewat `setOperator`.
3. Kunci operator butuh **saldo CELO** untuk gas — beda dari treasury yang tidak pernah menandatangani apa pun. Sediakan monitoring saldo; kalau habis, settle tiket berhenti diam-diam.

Sampai `setOperator` dijalankan, kedua fungsi batch akan revert `UnauthorizedOperator(address)` untuk siapa pun kecuali owner.

Catatan desain: debit tiket saat match tetap off-chain dan instan. `spendBatch` hanya menyusulkan hasilnya ke chain, jadi kalau panggilannya tertunda beberapa jam, gameplay tidak terganggu — yang terjadi cuma saldo on-chain sementara lebih tinggi daripada saldo DB. Rancang agar idempoten: kalau job gagal di tengah, jangan sampai batch yang sama terkirim dua kali dan mendebet ganda.

### 2.8 Lain-lain

- Ekstrak duplikasi `TIER_RULES` di `routes/leaderboard.ts:8-62` dan `routes/passport.ts:117-145` ke modul bersama **sebelum** menambah kompleksitas divisi.
- `BACKEND_PRIVATE_KEY` masih `optionalEnv` dengan default `""` (`config/env.ts:70`) → ubah ke `requireEnv` supaya gagal cepat dengan pesan jelas.
- Faucet belum punya guard anti-mainnet (`services/faucetService.ts:30-32`) → tolak aktif kalau `CHAIN_ID === 42220`.
- Session & game state masih in-memory `Map` → restart = semua user logout + match orphan. Prioritas naik setelah listing (traffic spike akan menumbangkan ini duluan).
- Pin versi dependency exact + `.npmrc` dengan `ignore-scripts=true` (syarat listing MiniPay).
- Tambah `"prebuild": "rm -rf dist"` — `dist/` menumpuk artefak basi.

---

## 3. FRONTEND

### 3.1 Paket listing MiniPay (kecil-kecil tapi memblokir)

| # | Yang kurang | Solusi |
|---|---|---|
| F1 | Tombol LOGIN ter-render sekilas saat deteksi MiniPay belum selesai (`HomePage.tsx:822-830`) | Tampilkan skeleton saat `isMiniPay` terdeteksi tapi account belum sinkron |
| F2 | **Three.js dari CDN `esm.sh`** (`public/script.js:1`) | Bundle via npm, hapus import CDN — buruk untuk PageSpeed & wajib masuk network manifest |
| F3 | Google Fonts via `@import` CSS (`globals.css:1`) | Ganti ke `next/font` (self-hosted, non-blocking) |
| F4 | Belum ada deeplink Add Cash MiniPay saat saldo kurang (`useBackendDepositFlow.ts:244-250`) | Implementasikan deeplink resmi |
| F5 | Metadata/OG masih hardcode `passchick.vercel.app` (`layout.tsx:7`, `appKit.ts:25`) | Sinkronkan ke `passchick.xyz` |
| F6 | Dependency `^` range, tidak ada `.npmrc` | Pin exact + `ignore-scripts=true` |

Dua syarat MiniPay terberat **sudah lolos**: auto-connect sudah benar, dan login MiniPay tidak minta signature.

### 3.2 Layar baru V2

**Daily claim (7 hari).** Reuse pola signed-transaction dari `claimPassport` (`GameBridgeClient.tsx:811-833`) — alurnya identik: backend kirim `{claim, signature}`, user submit transaksi. Ingat TTL 600 detik, jangan cache signature lama.

**Top-up tiket.** Adaptasi `ManageMoneyPage.tsx`:

- Mode `deposit` → jadi **TOP UP** (pilih stablecoin, $1 = 20 tiket)
- Mode `withdraw` → **DIPERTAHANKAN**, tapi conditional-render

> 🚨 **JANGAN hapus jalur withdraw.** Tidak ada fungsi owner yang bisa memindahkan saldo user di GameVault — `rescueToken` sengaja mengecualikannya. Satu-satunya jalan keluar dana user adalah `withdraw()` yang hanya bisa dipanggil user sendiri. Menghapus tombolnya = penyitaan permanen. Render kondisional saja:

```tsx
const moneyModes = [
  { mode: "deposit", label: "TOP UP" },
  ...(legacyBalance > 0n ? [{ mode: "withdraw", label: "WITHDRAW" }] : []),
];
```

User V2 baru saldonya nol → tab withdraw tidak pernah muncul, UI bersih. User lama tetap punya pintu keluar otomatis. Jangan pensiunkan alamat `GameVault` dari config frontend meski tabnya tersembunyi.

**Countdown season.** Tampilkan sebagai hitung mundur, bukan jam absolut (§8).

**Passport sebagai kanvas karir.** Modal Trust Passport yang ada (`HomePage.tsx:1415-1613`) sudah pas untuk diperluas — skin, badge, gelar Oracle, riwayat divisi. Data on-chain lewat `getSeasonHistory(address)`, `badges(address)`, `hasBadge(address, uint8)`, `verifiedHuman(address)`.

### 3.3 Utang teknis terbesar

Game engine adalah vanilla JS 6.317 baris (`public/script.js`) yang bicara ke React lewat `window.__CHICKEN_GAME_BRIDGE__`. Logic stake menempel di **tiga lapis**: `script.js` (`DEFAULT_STAKE` dkk, baris 34-36), `GameBridgeClient.tsx:668-706`, dan `ManageMoneyPage`.

Migrasi stake → tiket harus dikerjakan sebagai **satu epic yang menyentuh ketiga lapis sekaligus**, dengan test manual penuh. Jangan dicicil parsial — bridge contract-nya rapuh dan perubahan setengah jalan akan menghasilkan state tidak konsisten yang sulit dilacak.

### 3.4 Network manifest

Syarat listing. Domain yang teridentifikasi: `esm.sh` (hilang setelah F2), `fonts.googleapis.com` (hilang setelah F3), domain backend API + Socket.IO, `passchick.gitbook.io`, `t.me/passchick_support`.

---

## 4. Yang masih kurang / belum diputuskan

Tiga hal ini **belum ada**, dan semuanya butuh keputusan produk, bukan sekadar implementasi.

### 4.1 🔴 Passport pemain semuanya sudah kedaluwarsa

Passport punya `expiry` ~30 hari. Per 2026-07-22, **seluruh passport pemain di mainnet sudah lewat masa berlakunya** — `isPassportValid` mengembalikan `false` untuk semua. Ini bukan bug baru, kondisinya memang sudah begitu.

Dua konsekuensi:

1. Spec §7.3 menjanjikan gelar Oracle "permanen selamanya" dan passport sebagai *trophy cabinet*. Mustahil kalau passport-nya mati sebulan sekali.
2. **`canClaimMonetaryReward` ikut membaca expiry** — jadi dengan kondisi sekarang, tidak ada satu pun pemain yang bisa mencairkan reward uang, bahkan seandainya sudah verified.

Belum berdampak karena Season 1 diputuskan non-moneter, tapi ini akan muncul persis di season pertama yang berhadiah uang. Perlu diputuskan: perpanjang otomatis saat login, atau pisahkan identitas permanen (badge/gelar/riwayat — sudah tidak mengenal expiry) dari kredensial berjangka (tier).

### 4.2 Kontrak pembayar reward uang belum ada

Gerbangnya sudah dibangun (`canClaimMonetaryReward`), tapi **tidak ada kontrak yang benar-benar mencairkan stablecoin/CELO ke pemenang divisi** — padahal §9.2 menjanjikan "reward uang claimable on-chain". Konsekuensi keputusan Season 1 non-moneter, jadi tidak memblokir listing. Harus ada sebelum season berhadiah uang pertama **berakhir**, bukan saat pemenangnya sudah menagih.

### 4.3 Kunci owner: EOA tunggal, tapi sudah diamankan

Satu private key (`0x57394581…`) memegang wewenang upgrade ketiga kontrak. Per 2026-07-22 sudah dibereskan sebagian:

- ✅ Kunci dipindah dari plaintext `sc/.env` ke **keystore terenkripsi berpassword** (`~/.foundry/keystores/passchick-owner`). Semua operasi owner sekarang pakai `--account passchick-owner`, bukan `--private-key`.
- ✅ **Treasury dipisah** ke alamat berbeda yang private key-nya tidak ada di mesin developer. Revenue yang sudah terkumpul tidak ikut jatuh kalau kunci owner bocor.
- ⏸️ Multisig belum dipasang — masih peningkatan yang layak nanti, tapi bukan lagi lubang menganga.

Konsekuensi operasional: **operasi owner butuh terminal sungguhan** (prompt password perlu TTY). Tidak bisa dijalankan dari CI, script otomatis, atau agent. Yang termasuk operasi owner: upgrade kontrak, `setTreasury`, `setToken`, `setOperator`, `pause`.

✅ **Backend TIDAK terkena batasan ini.** `creditBatch` dan `spendBatch` sudah dipindahkan ke role `operator` (§2.7) yang punya kunci sendiri dan bisa jalan otomatis di server. Ini sempat jadi masalah desain — kedua fungsi itu awalnya `onlyOwner`, yang berarti backend tidak akan pernah bisa memanggilnya tanpa menaruh kunci upgrade di server produksi. Sudah diperbaiki lewat upgrade 2026-07-22 dan live di kedua jaringan.

### 4.4 Belum diputuskan

- Nominal pasti reward stablecoin/CELO per divisi untuk Season 1 (treasury saat ini $0.1133 — tidak menutupi satu pun pemenang Elite).
- Apakah USDm masuk whitelist top-up sejak hari pertama.
- Mekanik skin: metadata off-chain atau NFT? Rekomendasi: off-chain dulu, jangan tambah scope sebelum listing.
- Grace period streak daily login untuk tier Veteran+ — nice-to-have.

---

## 5. Cara mulai development hari ini

Pakai **Sepolia**, di mana tokonya terbuka penuh:

```bash
RPC=https://forno.celo-sepolia.celo-testnet.org
VAULT=0x1490e6B836f552e8504fE6404C30953B15F899c8
USDC=0x8FB74c2a678811aECC6Ed98Bd5Bc70E1119b7B61

# baca konfigurasi
cast call $VAULT "TICKETS_PER_USD()(uint256)"        --rpc-url $RPC   # 20
cast call $VAULT "MAX_TICKETS_PER_CLAIM()(uint16)"   --rpc-url $RPC   # 100
cast call $VAULT "claimSignatureTtl()(uint64)"       --rpc-url $RPC   # 600
cast call $VAULT "DAILY_CLAIM_TYPEHASH()(bytes32)"   --rpc-url $RPC

# cek saldo tiket & hari klaim terakhir seorang user
cast call $VAULT "ticketBalance(address)(uint256)" <USER> --rpc-url $RPC
cast call $VAULT "lastClaimDay(address)(uint32)"   <USER> --rpc-url $RPC
```

Faucet CELO Sepolia: https://faucet.celo.org

Contoh transaksi yang sudah terbukti jalan, bisa dipakai sebagai acuan bentuk calldata:

- `claimDaily` — `0x9579b27a721b93826c16c8ea542b43f8c6700b349ec1684adc3b4fadf62efb69`
- `buyTickets` ($3 → 60 tiket) — `0xe9f8c2f61ca0f2af3a93f4c4ac6fad0200b95ce5e4e173b31ac3977ffe037f53`

Kalau ada yang tidak cocok antara dokumen ini dan perilaku kontrak, **kontraknya yang benar** — sumbernya ada di `sc/src/TicketVault.sol` dan sudah verified di Celoscan. Kabari supaya dokumen ini diperbaiki.
