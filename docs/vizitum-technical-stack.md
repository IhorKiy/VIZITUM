# Vizitum: рекомендований технічний стек

## 1. Контекст

Vizitum - це B2B SaaS-платформа для польових команд з гібридною tenancy-моделлю:

- спільний web/app layer для всіх клієнтів;
- shared tenant database для pilot/team клієнтів;
- optional dedicated tenant database для Business/Enterprise;
- tenant-aware API, background jobs, imports, AI processing і reporting;
- mobile-first flow для польових представників.

Оптимальний стек має вирішувати не тільки CRUD і dashboards, а й:

- контроль tenant isolation;
- стабільну мобільну роботу в полі;
- імпорти CSV/XLSX;
- background jobs;
- AI transcription/extraction;
- audit і observability;
- майбутній перехід окремих клієнтів на dedicated DB без зміни app layer.

## 2. Рекомендований стек

### Frontend

Для web/admin/manager/executive частини:

- Next.js;
- React;
- TypeScript;
- Tailwind CSS;
- shadcn/ui або власна дизайн-система поверх Radix UI;
- TanStack Query;
- React Hook Form;
- Zod.

Цей стек підходить для:

- Platform Console;
- Company Admin;
- Manager Dashboard;
- Executive Dashboard;
- tenant-aware routing;
- SSR/SPA гібриду;
- складного dashboard UI.

### Field app

На старті оптимально робити mobile-first web/PWA, а не одразу native app.

Рекомендований старт:

- Next.js responsive/mobile-first interface;
- PWA support;
- IndexedDB для локального кешу;
- background sync як пізніше покращення.

Причина: для MVP offline-first mobile можна відкласти. Критично швидше отримати стабільний flow:

- план дня;
- картка точки;
- створення візиту;
- голосова нотатка;
- AI draft;
- задачі.

Коли з'явиться реальна потреба у сильному offline, push notifications, native audio UX і глибшій інтеграції з пристроєм, варто додати:

- React Native / Expo;
- shared TypeScript contracts з backend;
- той самий tenant-aware API.

### Backend

Рекомендований основний варіант:

- Node.js;
- TypeScript;
- NestJS;
- PostgreSQL;
- Prisma або Drizzle;
- Redis;
- BullMQ;
- OpenAPI / Swagger;
- Zod або class-validator.

NestJS добре підходить для Vizitum, бо платформа має багато доменних модулів:

- tenants;
- provisioning;
- users;
- roles and permissions;
- access scopes;
- locations;
- products;
- routes;
- visits;
- imports;
- AI extraction;
- audit;
- billing/status;
- operations.

Якщо команда хоче менше framework-магії, альтернативою може бути Fastify + TypeScript. Але для довгострокової модульної B2B SaaS-платформи NestJS є більш дисциплінованим вибором.

### ORM / query layer

Можливі два хороші варіанти:

- Prisma - швидше для MVP, зрозуміліше для команди, зручна схема і міграції;
- Drizzle - більше контролю над SQL, кращий варіант для складнішого tenant-aware query layer.

Практична рекомендація:

- для швидкого MVP: Prisma;
- для більш контрольованої production-архітектури з явним SQL-підходом: Drizzle.

У будь-якому варіанті потрібно мати власний tenant-aware data access layer. API не має довіряти `tenant_id` з client-side body.

### Database

Основна база даних:

- PostgreSQL.

Модель:

- platform database;
- shared tenant database;
- optional dedicated tenant databases.

Обов'язкові правила:

- усі tenant-owned таблиці у shared DB мають `tenant_id`;
- tenant визначається з host/slug/session/token, а не з body;
- shared DB queries мають бути tenant-aware;
- dedicated DB не має знати про інші tenants;
- background jobs завжди мають явний tenant context;
- isolation tests мають бути частиною CI.

PostgreSQL достатній для MVP і першої production-версії. Для великих обсягів аналітики пізніше можна додати:

- read replica;
- reporting schema;
- materialized views;
- ClickHouse для важкої event/reporting-аналітики.

### Auth

Для MVP:

- email/password;
- magic invite links;
- session cookies або JWT;
- tenant resolution за subdomain/slug;
- role/permission/scope на backend.

Можливі варіанти:

- власний auth module у NestJS;
- Auth.js, якщо auth тісно прив'язаний до Next.js;
- Clerk/Auth0 для швидшого enterprise auth і SSO, але з більшим vendor lock-in.

Рекомендація для Vizitum: власний auth module у backend на старті, бо tenant context, roles, scopes і invited users є доменно важливими.

### Storage

Для audio, photos, imports і exports:

- S3-compatible storage;
- AWS S3, Cloudflare R2 або Supabase Storage.

Storage paths мають бути tenant-scoped:

```text
tenants/{tenantId}/visit-audio/{visitId}.webm
tenants/{tenantId}/imports/{importId}.xlsx
tenants/{tenantId}/exports/{exportId}.xlsx
```

У logs не можна писати raw notes, transcripts або інші чутливі бізнес-дані.

### AI / Voice

AI flow має бути асинхронним:

1. User uploads audio або note.
2. Raw audio зберігається у tenant-scoped storage.
3. Transcription job створює transcript.
4. AI extraction job застосовує tenant-specific template.
5. User переглядає structured draft.
6. User підтверджує або редагує.
7. Backend зберігає final confirmed report.

Рекомендований стек:

- OpenAI API для transcription/extraction;
- BullMQ workers;
- versioned AI prompt templates;
- JSON Schema або Zod schema для structured output;
- audit trail для AI output.

Важливе правило: AI output не має автоматично змінювати бізнес-дані без підтвердження користувача, окрім явно дозволених low-risk полів.

### Background jobs

Потрібні з першого етапу:

- tenant provisioning;
- tenant migrations;
- imports;
- transcription;
- AI extraction;
- exports;
- backup/restore;
- daily/weekly summaries.

Рекомендований стек:

- Redis;
- BullMQ;
- окремий worker service;
- job status у platform database;
- tenant-aware job payloads.

### Infrastructure

Рекомендована production-friendly схема:

```text
Frontend: Vercel
API: Fly.io / Render / AWS ECS
Workers: Fly.io / Render / AWS ECS
Database: Managed PostgreSQL
Redis: Managed Redis
Storage: S3-compatible storage
CI/CD: GitHub Actions
```

Не варто будувати весь backend тільки на serverless functions, якщо є:

- long-running imports;
- tenant provisioning;
- tenant migrations;
- AI processing;
- exports;
- backup/restore jobs.

Для цих сценаріїв краще мати окремий API service і worker service.

### Observability

З першого дня потрібні:

- Sentry для frontend/backend errors;
- structured logs;
- OpenTelemetry;
- tenant-aware error grouping;
- job monitoring;
- audit events;
- migration status per tenant;
- health checks для shared і dedicated databases.

Observability має показувати помилки в розрізі tenant, але без витоку бізнес-даних.

### Testing

Обов'язкові типи тестів:

- unit tests для domain logic;
- integration tests для tenant isolation;
- API tests;
- import validation tests;
- migration tests;
- Playwright e2e smoke tests для основних ролей.

Критичні сценарії для автоматизації:

- tenant A не може читати tenant B;
- manager бачить тільки свій access scope;
- background job tenant A не читає tenant B;
- imports мають preview, validation і rollback/import history;
- AI summary не містить даних поза scope користувача;
- migrations працюють для shared DB і dedicated DB.

## 3. MVP stack

Для першої версії достатньо:

```text
Frontend:
Next.js + React + TypeScript + Tailwind + shadcn/ui + TanStack Query

Backend:
NestJS + TypeScript + Prisma + PostgreSQL

Jobs:
BullMQ + Redis + separate worker service

Database:
PostgreSQL: platform DB + shared tenant DB + optional dedicated tenant DB

Storage:
S3-compatible storage

AI:
OpenAI API + versioned prompts + structured extraction schemas

Testing:
Playwright + Vitest/Jest + tenant isolation integration tests
```

## 4. Що не варто ускладнювати на старті

На MVP не потрібно одразу робити:

- full offline-first native app;
- складний BI-конструктор;
- marketplace інтеграцій;
- custom domains;
- SSO;
- окремий deployment на tenant;
- ClickHouse;
- Kubernetes;
- складний event-driven microservices landscape.

Ці речі мають сенс пізніше, коли з'явиться production-навантаження, enterprise-вимоги або підтверджений попит.

## 5. Щодо Supabase-only підходу

Supabase можна використовувати як managed Postgres, storage або допоміжний сервіс на старті. Але не варто робити Supabase-only архітектуру як ядро Vizitum, якщо платформа серйозно планує:

- hybrid tenancy;
- dedicated tenant databases;
- provisioning;
- tenant-aware migrations;
- enterprise control;
- complex background jobs;
- AI processing pipeline.

Core tenancy, routing, permissions, provisioning і job orchestration краще тримати у власному backend layer.

## 6. Підсумок

Оптимальна стратегія для Vizitum:

- Postgres-first архітектура;
- власний tenant-aware backend;
- shared DB для pilot/team;
- dedicated DB як paid/enterprise option;
- mobile-first PWA для field users;
- окремі workers для imports, AI і provisioning;
- сильні isolation tests з першої версії.

Це дає швидкий запуск MVP, але не закриває шлях до Business/Enterprise клієнтів.
