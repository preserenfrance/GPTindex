# GPTIndex Readiness Checker

Majhna aplikacija za preverjanje, ali je spletna stran dovolj dobro pripravljena za pregledovanje in povzemanje v orodjih, kot je ChatGPT.

## Zagon

```bash
npm start
```

Aplikacija se zažene na `http://localhost:3000`.

## Testi

```bash
npm test
```

## Kaj preverja

- dostopnost strani in HTTP status
- `robots.txt` pravila za `ChatGPT-User`, `OAI-SearchBot` in `GPTBot`
- prisotnost `sitemap.xml`
- `title`, `meta description`, `canonical` in `lang`
- strukturirane podatke (`application/ld+json`)
- količino besedila ter osnovno semantično strukturo
- profile za `blog`, `shop` in `landing` strani
- primerjavo več URL-jev hkrati
- izvoz primerjave v CSV in tiskanje pogleda v PDF

## Premium crawl s Stripe

Brezplačni crawl pregleda do `5` strani. Za `10` ali `25` strani aplikacija ustvari Stripe Checkout sejo.

Pred zagonom nastavi:

```bash
set STRIPE_SECRET_KEY=sk_test_...
set STRIPE_PRICE_ID=price_...
set APP_BASE_URL=http://localhost:3000
```

Na `Windows PowerShell` lahko uporabiš:

```powershell
$env:STRIPE_SECRET_KEY="sk_test_..."
$env:STRIPE_PRICE_ID="price_..."
$env:APP_BASE_URL="http://localhost:3000"
npm start
```

`STRIPE_PRICE_ID` mora kazati na enkratni Stripe produkt za odklep dodatnih crawl strani.

## Email PDF porocilo

Lokalni izvoz CSV/PDF je zamenjan s posiljanjem PDF porocila na email uporabnika. Kopija se vedno poslje tudi na `peter@seos.si`.

Nastavi se:

```powershell
$env:SMTP_HOST="smtp.example.com"
$env:SMTP_PORT="587"
$env:SMTP_USER="no-reply@example.com"
$env:SMTP_PASS="secret"
$env:SMTP_SECURE="false"
$env:EMAIL_FROM="no-reply@example.com"
```
