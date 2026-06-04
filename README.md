# GPTIndex Readiness Checker

Majhna SaaS aplikacija za preverjanje, ali je spletna stran pripravljena za pregledovanje in povzemanje v orodjih, kot je ChatGPT.

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
- ključne AI readiness kriterije in priporočila
- PDF poročilo, poslano na email

## Stripe naročnine

Po osnovni analizi lahko uporabnik izbere paket za redno spremljanje:

- `Single Domain Monitor`: spremljanje 1 domene
- `Growth Monitor`: spremljanje do 5 domen

Na Vercelu nastavi:

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_SINGLE_DOMAIN_ID=price_...
STRIPE_PRICE_FIVE_DOMAINS_ID=price_...
APP_BASE_URL=https://gpt-index.vercel.app
ADMIN_TOKEN=izberi-dolg-skrivni-token
```

Oba Stripe price ID-ja naj bosta nastavljena kot recurring/subscription price.

`STRIPE_PRICE_ID` je še vedno podprt kot stari enkratni produkt za premium crawl, če ga želiš ohraniti.

## Admin

Admin je na voljo na `/admin` oziroma `https://gpt-index.vercel.app/admin`.

Za dostop vnesi isti token, kot je nastavljen v Vercelu pod `ADMIN_TOKEN`. Admin trenutno uporablja Stripe kot vir podatkov in prikazuje:

- število aktivnih, težavnih in ustavljenih naročnin
- ocenjen mesečni prihodek in kapaciteto domen
- seznam Stripe naročnin
- zadnje Stripe Checkout seje
- ročni preklic obnove naročnine ob koncu plačanega obdobja
- ponovno aktivacijo obnove, če je bila ustavljena pomotoma

Ročni izklop ne izbriše naročnine takoj, ampak nastavi `cancel_at_period_end=true`, zato uporabnik obdrži že plačano obdobje.

## Email PDF poročilo

PDF poročilo se pošlje na email uporabnika, kopija pa na `peter@seos.si`.

Na Vercelu nastavi:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=no-reply@example.com
SMTP_PASS=secret
SMTP_SECURE=false
EMAIL_FROM=no-reply@example.com
```
