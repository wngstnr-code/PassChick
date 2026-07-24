# Staging BE — Celo Sepolia (bukti FE-05)

Panduan menjalankan backend PassChick di **Celo Sepolia** untuk bukti FE-05,
tanpa menyentuh konfigurasi produksi/mainnet.

- Chain ID: `11142220` (Celo Sepolia)
- RPC: `https://forno.celo-sepolia.celo-testnet.org`
- TicketVault: `0x1490e6B836f552e8504fE6404C30953B15F899c8`
- Sumber alamat kontrak: `HANDOFF_V2.md §1`

Semua nilai Sepolia ada di `backend/.env.sepolia`. File itu di-source **setelah**
`.env`, jadi nilainya menimpa `.env` (mainnet) untuk sesi ini saja — `.env`
tidak diubah.

## Run command

Dari folder `backend/`:

```bash
set -a; source .env; source .env.sepolia; set +a; npx tsx src/index.ts
```

Cek saat boot, log harus menampilkan jalur Sepolia:

```
Network: celo-sepolia (chainId 11142220)
RPC: https://forno.celo-sepolia.celo-testnet.org
Frontend CORS:  http://localhost:3000,https://staging.passchick.xyz
```

Health check: `GET http://localhost:8000/health` → `{ "status": "ok" | "degraded", ... }`.

Kalau perlu diakses FE staging yang di-host (bukan localhost), ekspos port 8000
lewat tunnel (mis. `cloudflared tunnel --url http://localhost:8000` atau
`ngrok http 8000`) dan berikan URL publiknya ke tim FE sebagai
`NEXT_PUBLIC_BACKEND_API_URL` staging. Provisioning URL BE staging permanen
(mis. Railway service terpisah) di luar scope file ini — lihat Catatan koordinasi.

## CORS / whitelist origin FE staging

CORS memakai **exact-match allowlist** dari `FRONTEND_URL` (comma-separated),
di-parse di `src/config/env.ts` → `env.ALLOWED_ORIGINS`, dipakai di
`src/index.ts`. Tanpa trailing slash; spasi antar entri di-trim.

Saat ini di `.env.sepolia`:

```
FRONTEND_URL=http://localhost:3000,https://staging.passchick.xyz
```

> ⚠️ `https://staging.passchick.xyz` **masih asumsi** (konvensi turunan domain
> prod). **Verifikasi origin FE staging sebenarnya ke tim FE** sebelum dipakai
> sebagai bukti FE-05. Kalau berbeda (mis. `https://passchick-staging.vercel.app`),
> ganti entri kedua saja; localhost dibiarkan untuk dev.

Untuk menambah/mengubah origin: edit satu baris `FRONTEND_URL` di
`.env.sepolia`, comma-separated. Restart backend agar terbaca.

Jika FE staging pakai **URL preview Vercel** yang berubah tiap deploy
(`passchick-git-*.vercel.app`), exact-match tidak cukup — perlu ubah logika
CORS di `src/index.ts` jadi pencocokan pola. Ini menyentuh kode yang juga
dipakai produksi, jadi jangan dilakukan diam-diam; minta konfirmasi dulu.

## Yang TIDAK diubah

- `.env` (produksi/mainnet 42220, `passchick.xyz`, Railway prod) — tidak disentuh.
- `src/` — tidak ada perubahan kode (whitelist murni lewat env).
- `sc/` & `frontend/` — di luar scope backend.

## Checklist bukti FE-05

- [ ] Origin FE staging dikonfirmasi tim FE dan sudah masuk `FRONTEND_URL`.
- [ ] Backend jalan dgn `.env.sepolia` (log chainId 11142220, TicketVault 0x1490…99c8).
- [ ] `GET /health` mengembalikan 200.
- [ ] FE staging bisa memanggil BE tanpa error CORS (cek Network tab, tidak ada
      "Origin not allowed by CORS").
- [ ] URL BE staging (tunnel/host) diberikan ke tim FE sebagai `NEXT_PUBLIC_BACKEND_API_URL`.

## Catatan koordinasi (untuk tim FE / infra)

1. **Butuh dari tim FE:** origin FE staging persis (scheme+host, tanpa trailing
   slash) untuk di-whitelist. Placeholder saat ini `https://staging.passchick.xyz`.
2. **URL BE staging permanen:** kalau butuh URL BE staging yang stabil (bukan
   tunnel), perlu deploy service Sepolia terpisah (mis. Railway) dgn env
   `.env.sepolia` + secret dari `.env` (SUPABASE_*, BACKEND_PRIVATE_KEY). Ini
   keputusan/infra di luar file backend — belum dilakukan.
3. **DB:** `.env.sepolia` sengaja tidak override `SUPABASE_*`, jadi data claim
   Sepolia bercampur dgn DB produksi. Kalau mau bersih, buat Supabase project
   dev terpisah dan override kedua nilai itu di `.env.sepolia`.
