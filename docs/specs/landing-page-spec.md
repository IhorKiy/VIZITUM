# Landing Page Spec

Status: draft specification for the public marketing landing (`/` in `uk`, `/en` in `en`). This file is the agreed structure and copy **before** any visual or implementation work. It replaces the current single-card placeholder (`apps/web/components/landing.tsx`).

Source material: `docs/ukraine-go-to-market-plan.md` — positioning (§5), differentiation (§6), packaging (§7), segments (§3), ICP (§4), one-pager structure (§14), objections (§17). This spec resolves that material into page sections; it does not invent new positioning. When the GTM plan and this file disagree, the GTM plan wins and this file is corrected.

## Decisions taken

| Decision | Choice | Consequence |
| --- | --- | --- |
| Primary CTA | Demo request **form** | Needs a new public API endpoint, lead storage, notification email and anti-spam. Ships as its own PR *before* the landing. |
| Pricing on page | Not shown | Packages are described by capability and audience only. Price is named in conversation, after team size is known. GTM §8 still calls the 300-700 UAH figure a hypothesis. |
| Visual proof | Real product screenshots | Captured from the seeded demo tenant, Ukrainian UI, synthetic data only. |
| Mockup medium | This spec, then an HTML prototype | No Figma. The design system already exists as CSS custom properties; the prototype is built on those tokens and its markup carries into the real components. |

Derived from those:

- The page sells **Vizitum Team** (GTM §7 "Team-first"). Business appears only as the growth path, one block, no separate page.
- The `landing.badge` string ("У розробці" / "In development") is replaced. A page whose primary action is "request a demo" cannot also say the product is not ready. Proposed replacement: **«Набираємо команди на пілот»** / **"Onboarding pilot teams"** — honest about the stage, and actionable.
- Secondary CTA stays "Вхід на платформу" → `/sign-in`, kept subordinate: most traffic has no workspace.

## Audience and job of the page

Reader: a Head of Sales / Field Force Manager / Commercial Director / owner at a Ukrainian company with 5-30 field reps, currently running visits through Excel, Google Sheets, Telegram or Viber (GTM §4).

The page has one job: **make that person request a demo.** Everything else is subordinate. The reader is not buying software, they are buying an answer to "what is my team actually doing out there, and why do I only find out in the evening".

Non-goals: self-service signup, a feature matrix, a public price list, an English-first page (uk is the primary market; `/en` exists for parity and for non-Ukrainian readers, not as the main funnel).

## Page structure

Eleven sections. Each states its single message, its content, and draft copy in both languages. Copy is a draft for review — the structure is the part that should be settled first.

### 1. Hero

Message: *you can run the field team without spreadsheets and evening reports.*

Contents: brand block, language switch, H1, subheading, primary CTA (scrolls to the form in §11), secondary sign-in link.

- **H1 uk:** «Керуйте польовою командою без Excel і вечірніх звітів»
- **H1 en:** "Run your field team without spreadsheets and evening reports"
- **Sub uk:** «Vizitum — маршрути, візити, задачі та ШІ-обробка звітів для торгових і сервісних команд від 5 представників. Пілот запускається за тиждень.»
- **Sub en:** "Vizitum turns routes, visits, tasks and voice notes into one workflow for sales and service teams of 5+ reps. A pilot goes live in a week."
- **CTA uk / en:** «Запросити демо» / "Request a demo"
- **Secondary uk / en:** «Вхід на платформу» / "Sign in"

Alternative H1 to test later: «Маршрут, візит, звіт — один процес замість трьох файлів» / "Route, visit, report — one process instead of three files".

### 2. Problem

Message: *this is your evening, and it is not working.*

Three lines, written as recognition rather than accusation (GTM §3 pains, all three segments):

- uk: «Маршрут в одному файлі, звіти — в месенджері, задачі — в голові представника.»
- uk: «Ви бачите цифру продажів, але не бачите, що насправді сталося на точці.»
- uk: «Представник витрачає вечір на звіт, який ніхто не перечитує.»
- en: "The route is in a spreadsheet, the reports are in a messenger, the follow-ups are in someone's head."
- en: "You see the sales figure, not what actually happened at the location."
- en: "Reps spend their evening on a report nobody reads twice."

### 3. How it works

Message: *four steps, and the fourth one is the point.*

This is the section that carries the demo. Four numbered steps:

1. **«Маршрут на день» / "The day's route"** — «Представник відкриває сьогоднішній маршрут: які точки, в якому порядку, що з собою.» / "The rep opens today's route: which locations, in what order, what to bring."
2. **«Візит» / "The visit"** — «Фіксує візит на точці: асортимент, потенціал, контакти, фото.» / "Logs the visit on site: assortment, potential, contacts, photos."
3. **«Голосова нотатка» / "A voice note"** — «Диктує підсумок своїми словами — 30 секунд замість форми на 15 полів.» / "Dictates the outcome in their own words — 30 seconds instead of a 15-field form."
4. **«Звіт і наступний крок» / "Report and next step"** — «ШІ готує **чернетку** структурованого звіту: домовленості, заперечення, проблемні SKU. Представник перевіряє, править і зберігає. Задача на наступний крок створюється тут же.» / "AI drafts the structured report — agreements, objections, problem SKUs. The rep reviews, edits and saves. The follow-up task is created right there."

**Copy rule, non-negotiable:** the AI is described as preparing a *draft* that a person confirms. Never as the source of truth, never as "the AI writes your reports". This is both a product invariant (`AGENTS.md`: manual report confirmation must always remain available) and the answer to the strongest objection in the market (GTM §17). Any copy variant that drops the word "чернетка"/"draft" is wrong.

### 4. Who it is for

Message: *if this is your team, it fits.*

Three cards from GTM §3, each: who / the pain / the one-line offer.

- **Дистрибуція і торгові команди** — «Польовий інструмент для торгових представників: маршрути, точки, візити, SKU, задачі і контроль команди в одному місці.»
- **Сервісні та операційні команди** — «Єдиний процес для польових сервісних команд: маршрут, об'єкт, візит, задача, звіт і контроль виконання без хаосу в месенджерах.»
- **B2B-команди з регулярними візитами** — «Запустіть єдиний процес польових візитів за 7 днів: маршрути, точки, візити, продукти або послуги, задачі та дашборд керівника.»

English equivalents translated from the same offers, not re-invented.

### 5. Value by role

Message: *everyone in the chain gets something, not just the boss who buys it.*

Three columns, copy lifted from GTM §5 (already written for exactly this):

- **Представнику** — менше ручної звітності після роботи: відкрив маршрут, провів візит, продиктував результат, ШІ допоміг структурувати звіт і наступну дію.
- **Керівнику** — видно, які точки відвідує команда, що презентовано, які задачі відкриті і де є потенціал для росту.
- **Власнику / комерційному директору** — польова команда переходить з Excel і месенджерів у прозорий процес: активність, покриття території, розвиток ключових точок.

### 6. Proof — product screenshots

Message: *this exists and it looks like this.*

Four screenshots from the seeded demo tenant, Ukrainian interface, synthetic data only. Proposed set, one per claim made above:

| Screen | Route | Claim it proves |
| --- | --- | --- |
| Today's route (mobile) | `/[tenantSlug]/field` | The rep's day is one screen. |
| Voice capture → report draft (mobile) | `/[tenantSlug]/field/visits/[visitId]` | The 30-second note becomes a structured report. |
| Manager dashboard (desktop) | `/[tenantSlug]/manager` | The manager sees the whole team. |
| Location card with history (desktop) | `/[tenantSlug]/manager/locations/[locationId]` | Every location has a history, not a message thread. |

Rules: no real client names, no real phone numbers or addresses, no platform-owner screens. Demo tenant data is already synthetic — verify before shipping, do not assume. Mobile shots framed in a device outline, desktop shots in a plain browser frame or none.

### 7. Compared to what you use now

Message: *we know what you already have, and this is the honest difference.*

Table from GTM §6, unchanged:

| Що зараз | Чого бракує | Що дає Vizitum |
| --- | --- | --- |
| Excel / Google Sheets | Дешево, але немає процесу і контролю | Єдиний робочий цикл для команди |
| Telegram / Viber | Швидко, але дані губляться | Структуровані візити, задачі, історія по точці та ШІ-резюме нотаток |
| Загальна CRM | Є угоди, але немає польової логіки | Маршрути, точки, візити, асортимент/SKU і задачі |
| Важке галузеве рішення | Потужно, але дорого і довго | Легкий старт для окремої польової команди або регіону |

No named competitors. The comparison is against categories the reader recognises in themselves.

### 8. Packages

Message: *start small, grow into it.*

Three cards, **no prices**, each ending in the same CTA:

- **Пілот** — 14-30 днів, 5-10 представників, до 300-500 точок. Імпорт вашої бази, стартовий шаблон візиту під ваш сегмент, onboarding-дзвінок, pilot review через 7-10 днів, підсумковий звіт.
- **Команда** — головний пакет для 5-30 представників. Все з пілоту + повна база точок, необмежені візити, ШІ-підсумки, задачі і контроль виконання, дашборд керівника, фільтри, експорт, підтримка в робочий час.
- **Бізнес** — для 30+ представників або кількох регіонів. Все з «Команди» + кілька керівників з різними зонами відповідальності, access scope по регіонах і територіях, executive-звітність, розширені ШІ-підсумки, кастомні поля, допомога з міграцією, пріоритетна підтримка, dedicated database як опція.

Visual weight: "Команда" is the emphasised card. Business is deliberately last and least detailed (GTM §7: do not sell Business complexity into a Team deal).

### 9. How a pilot starts

Message: *this is a week of your time, not a quarter.*

Two columns.

**Що робимо ми:** створюємо ваш робочий простір, обираємо шаблон візиту під ваш сегмент, допомагаємо з імпортом бази, проводимо onboarding-дзвінок, через 7-10 днів — pilot review з результатами.

**Що потрібно від вас** (GTM §4 checklist):

- база точок, клієнтів або об'єктів в Excel/CSV;
- список 5-10 представників і хоча б один керівник;
- базовий список продуктів, SKU або товарних груп, якщо вони потрібні у звіті;
- території або просте правило видимості точок;
- приклад вашого поточного звіту після візиту;
- критерії, за якими ви визнаєте пілот успішним.

That last bullet is the most important one on the page and should be visually marked — it converts a demo into a measurable pilot.

### 10. FAQ

Message: *your objection is reasonable and here is the answer.*

Five items, all from GTM §17, answered in the reader's own framing rather than defensively:

1. **«У нас вже є CRM»** — Питання не в CRM, а в тому, чи закриває вона польовий сценарій: маршрут, візит, точку, задачі, дашборд. Якщо ні — Vizitum стає легким польовим шаром поверх того, що вже є, або пілотом для однієї команди.
2. **«Представники не будуть цим користуватися»** — Тому візит закривається голосовою нотаткою за 30 секунд, а не формою на 15 полів. У пілоті ми міряємо adoption і час створення звіту й прибираємо зайві поля.
3. **«ШІ буде помилятися у звітах»** — Буде. Тому ШІ готує чернетку, а не фінальний звіт: представник перевіряє і редагує перед збереженням. Ручне підтвердження звіту доступне завжди.
4. **«Нам потрібні інтеграції»** — На пілоті — імпорт і експорт. Інтеграції обговорюємо після того, як цінність підтверджена.
5. **«Немає бюджету»** — Порахуйте час керівника на збір звітів і точки, які випали з покриття. Пілот дає цифру, з якою можна прийти до бюджету.

Ukrainian is the source here; English is a translation of the same answers.

### 11. Final CTA — demo request form

Message: *one form, six fields, no obligation.*

Fields (all `maxLength` from `apps/web/lib/input-limits.ts`):

| Field | Required | Notes |
| --- | --- | --- |
| Ім'я | yes | |
| Компанія | yes | |
| Email | yes | validated |
| Телефон | no | |
| Кількість представників | yes | select: 1-5 / 5-15 / 15-30 / 30+ — doubles as ICP qualification |
| Коментар | no | textarea |
| Згода на обробку персональних даних | yes | checkbox, links to the privacy policy |

Below the form, keep `CONTACT_EMAIL` (`support@vizitum.com`) printed as plain text: a form is not a substitute for a visible address, and the existing e2e test asserts the address is reachable.

Success state: inline confirmation on the page, not a redirect. Failure state: the address as fallback, so a broken endpoint never leaves the reader with nowhere to go.

## Technical constraints

These are not negotiable by the design; the prototype must respect them.

- **Prerendering.** `/` and `/en` must stay `○` (static) in the `web:build` output. The public route group (`app/(public)/`) mounts no `NextIntlClientProvider` precisely so these two pages stay prerenderable — see the comment in `apps/web/app/(public)/layout.tsx`. Nothing added here may read `headers()`, cookies or request-scoped locale.
- **The form and i18n.** The shared `PendingSubmitButton` calls `useTranslations` unconditionally, so it cannot be dropped into the public group without a provider. Two options: pin a `common`-only provider around the form (as the two sign-in pages already do), or pass labels as props the way `Landing` passes its dictionary today. Prefer the second — it keeps the whole landing prop-driven and provider-free.
- **Copy lives in the dictionaries.** Every string goes into `apps/web/messages/{en,uk}.json` under `landing.*`. `en` is canonical, `uk` must be a real translation. `npm run web:i18n:check` fails on Cyrillic literals outside `messages/`, and it runs in CI.
- **CSS.** `apps/web/app/globals.css` is already ~7,100 lines and is loaded by every workspace screen. Marketing CSS goes in its own file imported by the landing pages only, so the workspace bundle does not carry it. The existing `.landing-*` block (globals.css ~4172-4315) is folded into the new file or deleted with the placeholder.
- **Design tokens.** Build on the existing custom properties — `--bg` `#f6f4ef`, `--accent` `#176b5f`, `--accent-strong` `#0d4f47`, `--ink` `#17211b`, `--sidebar-bg` `#11251f`. The landing must look like the product, not like a different company.
- **Images.** Screenshots go through `next/image` from `apps/web/public/`, exported as WebP/AVIF with explicit dimensions. Four full-size PNG screenshots would dominate the page weight otherwise.
- **Input limits.** Every free-text field carries a `maxLength` from `INPUT_LIMITS`; new keys added there, never inline numbers.
- **E2E.** `apps/web/e2e/public-entry.spec.ts` currently pins that all four public pages render and that both landings expose the contact address. Extend it rather than replacing it: the address assertion must survive, and the form needs its own render + validation check.
- **SEO.** `lib/landing-metadata.ts` already handles title/description/canonical/hreflang for both languages; extend it for the new copy and add an OG image. `app/sitemap.ts` and `app/robots.ts` need no change unless new public URLs appear (see the privacy policy below — it adds one).

## Delivery order

Four changes, in this order. Each is independently mergeable.

1. **Demo request endpoint (backend).** New public, unauthenticated, rate-limited endpoint; a Prisma model for stored leads; notification to `support@vizitum.com` through the existing Resend integration (`src/modules/email`); anti-spam (honeypot + rate limit, no CAPTCHA — solving CAPTCHAs is exactly the friction a B2B lead form cannot afford). No tenant context: a lead exists before any tenant does, so this endpoint sits outside the tenancy invariant and must be explicitly reviewed for that. Tests + `docs/reference/api-reference.md` + `docs/reference/data-model.md` updated in the same PR.
2. **Privacy policy page.** A lead form collects personal data; the consent checkbox needs somewhere to link. New public route, both languages, added to `sitemap.ts`. Small, but it blocks shipping the form.
3. **Landing: structure, copy, styles.** Sections 1-5 and 7-11, the new CSS file, dictionary entries, e2e extension. Screenshot slots left as placeholders.
4. **Landing: proof assets.** Screenshots captured, optimised and dropped into the slots, plus the OG image.

The HTML prototype sits between this spec and step 3 — it is throwaway and not committed to `apps/web`.

## Open questions

Answer these before step 1, they change the work:

1. **Privacy policy content.** Who writes it? A lead form without one is a legal gap, not a nice-to-have. Whether a Ukrainian-law-specific text is needed or a standard SaaS policy suffices is a question for the owner, not for this repo.
2. **Lead notifications.** Email to `support@vizitum.com` only, or also a Telegram notification? Response speed on a B2B demo request matters more than the form itself.
3. **Analytics.** Nothing currently measures anything on `/`. Without it, none of GTM §15's marketing metrics (leads, demo conversion) can be reported. Which tool, and does it need a cookie banner (which affects the privacy policy above)?
4. **Video.** GTM §18 lists a 60-90 second video as a task. If it will exist soon, section 6 should be designed with a video slot at the top rather than retrofitted.
5. **Hero H1.** The alternative in §1 is worth a second opinion before the prototype fixes one in place.
