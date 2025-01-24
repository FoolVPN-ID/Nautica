# Welcome to Nautica

Sebuah repository serverless tunnel studi kasus Indonesia

# Fitur

- [x] Otomatis split protocol VLESS, Trojan, dan Shadowsocks
- [x] Reverse proxy
- [x] Cache daftar proxy
- [x] Support TCP dan DoH
- [x] Transport Websocket CDN dan SNI
- [x] KV proxy key (proxy berdasarkan country)
- [x] Pagination
- [x] Tampilan web bagus dan minimalis (Menurut saya)
- [x] Dark mode
- [x] Auto check (ping) akun
- [x] Ambil akun dalam beberapa format (link, clash, sing-box, dll)
- [x] Registrasi wildcard
- [x] Menambahkan filter
  - [x] Negara `&cc=ID,SG,...`
- [x] Subscription API
  - [x] Country Code `&cc=ID,SG,JP,KR,...`
  - [x] Format `&format=clash` (raw, clash, sfa, bfr, v2ray)
  - [x] Limit `&limit=10`
  - [x] VPN `&vpn=vless,trojan,ss`
  - [x] Port `&port=443,80`
  - [x] Domain `&domain=zoom.us`
- [x] Tombol `Deploy to workers` untuk instant deployment

# Todo (Belum Selesai)

- [x] Lebih efisien (Partial) (I hate Javascript btw, jadi males buat benerin)
- [ ] Skema URL shadowsocks

Kode ini masih perlu banyak perbaikan, jadi silahkan berkontribusi dan berikan PR kalian!

# Catatan

- Harus UUID v4 Variant 2
- Gunakan security `none`
- Gunakan DoH di aplikasi VPN kalian jika tidak bisa browsing atau membuka website
  - Contoh DoH `https://8.8.8.8/dns-query`

# Cara Deploy

## Instant

Klik tombol di bawah  
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/FoolVPN-ID/Nautica)

## Manual

1. Buat akun cloudflare
2. Buat worker
3. Copy kode dari `_worker.js` ke editor cloudflare worker
4. (Optional) Masukkan link daftar proxy kalian ke dalam environemnt variable `PROXY_BANK_URL`
5. (Optional) Masukkan link target reverse proxy ke environment variable `REVERSE_PROXY_TARGET`
6. Deploy
7. Buka `https://DOMAIN_WORKER_KALIAN/sub`

- Contoh daftar proxy [proxyList.txt](https://raw.githubusercontent.com/dickymuliafiqri/Nautica/refs/heads/main/proxyList.txt)
- Contoh reverse proxy [example.com](https://example.com)

## Cara Aktivasi API

Salah satu fungsi API adalah agar kalian bisa melihat dan menambahkan subdomain wildcards ke workers.

Berikut cara aktivasinya:

1. Masuk ke halaman editor workers yang sudah kalian buat
2. Isi `variable` dari baris ke 4-9 sesuai dengan key yang kalian miliki
3. Deploy

### Aktivasi Wildcard (Custom Domain)

1. Selesaikan langkah [Aktivasi API](#cara-aktivasi-api)
2. Isi variable `rootDomain` dengan domain utama kalian
   - Contoh: Domain workers `nautica.foolvpn.me`, berarti domain utamanya adalah `foolvpn.me`
3. Isi variable `serviceName` dengan nama workers kalian
   - Contoh: Domain workers `nautica.foolvpn.me`, berarti nama workersnya adalah `nautica`
4. Buat custom domain di pengaturan workers dengan kombinasi `serviceName`.`rootDomain`
   - Contoh: `nautica.foolvpn.me`

# Endpoint

- `/` -> Halaman utama reverse proxy
- `/sub/:page` -> Halaman sub/list akun
- `/api/v1/sub` -> Subscription link, [Queries](#fitur)

# Footnote

- Hal aneh lain yang saya kerjakan [FoolVPN](https://t.me/foolvpn)
- Tanya-tanya -> [Telegram](https://t.me/d_fordlalatina)
