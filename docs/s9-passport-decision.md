# S9 — Keputusan Passport Expiry (Opsi B)

**Diputuskan:** 2026-07-23 (product owner)
**Konteks:** update_v2.md §13.2-S9 — passport on-chain kedaluwarsa ~30 hari;
semua passport mainnet saat ini expired, dan `canClaimMonetaryReward` di
kontrak membaca expiry, sehingga tanpa keputusan ini tidak ada pemain yang
bisa mencairkan reward uang kelak.

## Keputusan

**Opsi (b): pisahkan identitas permanen dari kredensial berjangka.**

- **Permanen, tidak pernah kedaluwarsa:** badge, gelar (mis. Oracle),
  `seasonHistory`, riwayat karir. Storage kontrak V2 memang sudah berbentuk
  begini — `badges` dan `seasonHistory` tidak mengenal expiry.
- **Berjangka (perlu refresh):** `tier` sebagai kredensial aktif. Renewal
  memakai jalur yang sudah ada: `POST /api/passport/issue-signature`
  menerbitkan claim dengan `issuedAt`/`expiry` baru, user submit
  `claimWithSignature` (kontrak menerima `issuedAt` lebih baru).

## Status backend (selesai per 2026-07-23)

- Jalur reward season (`rewardBatchExecutor`, `seasonService`) TIDAK membaca
  expiry — reward tiket tidak terpengaruh passport expired. ✅
- `GET /api/passport/status` memakai `effectiveTier` yang fallback ke tier
  hasil statistik saat passport invalid — karir tidak hilang. ✅
- Field baru `passport.expired` di response `/status`: `true` hanya untuk
  "pernah punya tier, belum revoked, expiry lewat" — beda dari "belum pernah
  punya". FE bisa menampilkan CTA "perpanjang tier" alih-alih menganggap
  pemain tanpa passport. ✅

## Catatan koordinasi

**Untuk tim SC (wajib sebelum reward uang hidup / FE-10):**
`canClaimMonetaryReward` saat ini membaca expiry secara buta. Dengan opsi (b),
gate reward moneter harus dipilih salah satu:
1. Berhenti membaca expiry, ganti gate ke syarat yang permanen
   (verified-human + riwayat season), ATAU
2. Tetap membaca expiry, tapi flow claim FE-10 mewajibkan renewal tier dulu
   (satu tx `claimWithSignature`) sebelum tx claim reward.
Opsi 2 tanpa perubahan kontrak — tapi keputusannya milik tim SC; jangan
diasumsikan dari backend.

**Untuk tim FE (FE-09/FE-10):**
- Copy "gelar permanen selamanya" AMAN dipakai untuk badge/gelar/riwayat.
- Untuk `tier`, gunakan `passport.expired` dari `/status`: `expired:true` →
  tampilkan status "tier perlu diperpanjang" + CTA renewal (flow
  `issue-signature` → wallet tx), BUKAN state kosong.
