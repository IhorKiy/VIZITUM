# Vizitum MVP Product Specification: Team Pilot

## 1. Призначення документа

Цей документ фіксує перший реалізаційний scope для Vizitum перед технічною розробкою.

Ціль MVP - запустити робочий `Vizitum Team Pilot` для малих і середніх польових команд в Україні, щоб клієнт міг перейти від Excel, Google Sheets, Telegram або Viber до єдиного процесу:

- імпорт точок, представників і продуктів;
- план дня або маршрут представника;
- картка точки;
- створення візиту;
- текстова або голосова нотатка після візиту;
- AI-структурування звіту;
- задачі та follow-up;
- dashboard керівника;
- pilot review через 7-10 днів використання.

MVP має довести основну цінність Vizitum: керівник бачить реальну роботу польової команди, а представник швидко фіксує результат візиту без ручної вечірньої звітності.

## 2. MVP-рамка

### Основний продукт

Перший реалізаційний режим: `Vizitum Team`.

Перший комерційний сценарій: `Pilot`.

Узгодження з user flow документом:

- `Pilot` - перший launch сценарій зі статусом `pilot_active`, shared DB, product mode `team` і review після 7-10 днів.
- `Team` - базовий продуктовий режим MVP: один tenant workspace, один або кілька Company Admin, один або кілька Team Manager з full tenant view, Field Representatives, прості маршрути, задачі, manager dashboard і pilot review.
- `Business` - розширення того самого core після MVP: granular access scope, Executive role/dashboard, регіональна структура, розширені звіти і dedicated DB як paid option.
- `Pilot`, `Team` і `Business` не є окремими codebase або deployment models; MVP реалізує спільний tenant-aware app layer і shared DB за замовчуванням для pilot/team.

MVP segment templates:

- `distribution / trade reps`;
- `service / field operations`;
- `partner / account visits`.

Ці три templates мають бути production-ready для першого демо і пілотів. Вони не є окремими продуктами, схемами даних або codebase. MVP реалізує один універсальний core, а segment template визначає стартові labels, типи точок, типи візитів, базові поля, KPI і AI extraction preset. Інші vertical presets, такі як `FMCG`, `OTC`, `pharma` або `custom`, залишаються перспективою/template backlog і не є selectable options у першому tenant creation flow.

### Цільовий клієнт MVP

- Українська компанія.
- Для першого пілоту зазвичай 5-10 польових представників; для Team після пілоту - до 30 представників.
- Є керівник польової команди, Head of Sales, Commercial Director або власник.
- Команда регулярно відвідує торгові точки, партнерів, клієнтів або об'єкти.
- Поточний процес ведеться в Excel, Google Sheets, Telegram, Viber або простій CRM без польового сценарію.
- Для пілоту не потрібна складна інтеграція з ERP.
- Рішення про пілот може прийняти 1-2 людини.

### Що MVP має дозволяти

- Команді Vizitum створити pilot tenant.
- Дати Company Admin можливість завантажити або підтвердити стартові дані клієнта.
- Запросити одного або кількох адміністраторів, керівника і представників.
- Дати представнику mobile-first flow для робочого дня.
- Дати керівнику dashboard для контролю активності, візитів, задач і покриття.
- Сформувати простий pilot review після першого тижня.

### Що MVP свідомо не покриває

- Dedicated tenant database як self-service опція.
- Executive Dashboard.
- Granular access scope по регіонах, командах або територіях.
- Повноцінний offline-first режим.
- Native mobile app.
- Billing automation.
- Складні інтеграції з ERP, складом або бухгалтерією.
- Route optimization.
- BI-конструктор.
- Marketplace інтеграцій.

## 3. Ролі MVP

MVP має підтримувати кілька ролей на одному користувачі всередині tenant. Ролі не є взаємовиключними: effective permissions користувача формуються як об'єднання призначених ролей з урахуванням tenant product mode і access scope.

Практичні правила:

- Company Admin може призначити собі роль `Team Manager`, якщо в компанії одна людина одночасно налаштовує tenant і керує командою.
- Team Manager може паралельно мати роль `Field Representative`, якщо керівник також сам виконує візити.
- Один email / user account не треба дублювати для різних ролей у тому самому tenant.
- Якщо користувач має кілька ролей, інтерфейс має показувати role switcher або відкривати останній обраний робочий режим.

### Platform Owner

Внутрішній користувач Vizitum. У MVP може працювати через просту Platform Console або через адміністративні seed/scripts, якщо повна console ще не готова. Його зона відповідальності - створити і підтримувати tenant як технічний контейнер, а не адмініструвати щоденні дані клієнта.

Основні задачі:

- створити pilot tenant;
- обрати segment template;
- налаштувати базові tenant-параметри: plan, product mode, country, timezone, language, database placement;
- запросити одного або кількох Company Admin;
- перевірити статус tenant;
- бачити health, provisioning, migration і import job status;
- бачити базові usage/pilot metrics.

Platform Owner не створює користувачів клієнта вручну, не призначає ролі всередині команди, не налаштовує маршрути і не керує операційними довідниками tenant, якщо це не тимчасова assisted setup дія для запуску пілоту.

### Company Admin

Адміністратор клієнта всередині tenant workspace. Це основна роль для операційного налаштування компанії після створення tenant.

Основні задачі:

- перевірити дані компанії;
- імпортувати або підтвердити точки;
- імпортувати або підтвердити продукти/SKU;
- створити або підтвердити користувачів;
- призначити ролі;
- перевірити шаблон візиту;
- налаштувати базові поля, довідники, правила доступу, брендінг і tenant settings;
- запросити представників.

У першому MVP Company Admin може частково покладатися на команду Vizitum для assisted setup, але саме Company Admin підтверджує правильність даних, ролей і налаштувань всередині tenant.

### Team Manager

Керівник польової команди. У режимі `Team` має full tenant view. Це означає перегляд усіх операційних даних поточного tenant, але не автоматично admin/edit rights. У режимі `Business` може мати access scope за регіоном, командою, територією, групою точок або конкретними представниками.

Основні задачі:

- бачити активність команди;
- бачити план/факт візитів;
- призначати маршрути або плани дня представникам;
- переглядати візити та AI-підсумки;
- бачити відкриті та прострочені задачі;
- знаходити точки без покриття;
- створювати follow-up задачі;
- готуватися до pilot review.

Team Manager не є системним адміністратором за замовчуванням: він не імпортує великі довідники, не керує billing, не змінює tenant settings і не призначає ролі без додаткових прав.

### Company Owner / Executive

Роль для пакету `Business` або більших клієнтів. У `Team Pilot` вона не входить у реалізаційний MVP і описана тут тільки як контекст для майбутнього розширення тієї самої tenant-моделі.

Для малих команд high-level огляд у MVP виконує Team Manager через manager dashboard. Окремий Executive Dashboard, регіональна структура, granular access scope і управлінські звіти залишаються Business/post-MVP capabilities.

Майбутні задачі:

- бачити executive dashboard;
- переглядати активність по компанії, регіонах або командах;
- бачити покриття, динаміку візитів, проблемні точки і відкриті задачі;
- читати AI-підсумки на рівні компанії, регіону, команди або продукту;
- експортувати управлінські звіти.

Executive не налаштовує tenant, імпорти, ролі, маршрути або довідники без додаткових прав.

### Field Representative

Польовий користувач. Основний mobile-first користувач MVP.

Основні задачі:

- бачити план на сьогодні;
- створювати або змінювати власний маршрут чи план дня на базі призначених йому локацій;
- відкрити точку;
- почати візит;
- написати або продиктувати нотатку;
- перевірити AI draft;
- зберегти звіт;
- створити або виконати задачу;
- бачити власну історію візитів.

## 4. Основні user stories

### Platform Owner

- Як Platform Owner, я хочу створити pilot tenant, щоб швидко підготувати середовище для клієнта.
- Як Platform Owner, я хочу обрати segment template, щоб tenant отримав релевантні поля, типи візитів і AI schema.
- Як Platform Owner, я хочу запросити одного або кількох Company Admin, щоб клієнт сам керував користувачами, ролями і налаштуваннями всередині tenant.
- Як Platform Owner, я хочу бачити provisioning, health і статус import jobs, щоб розуміти, чи tenant технічно готовий до запуску.
- Як Platform Owner, я хочу бачити pilot metrics, щоб провести review з клієнтом.

### Company Admin

- Як Company Admin, я хочу імпортувати точки з CSV/XLSX, щоб швидко перенести базу клієнтів.
- Як Company Admin, я хочу імпортувати представників, щоб запросити команду без ручного створення кожного користувача.
- Як Company Admin, я хочу імпортувати продукти/SKU, щоб представники могли фіксувати, що обговорювали на візиті.
- Як Company Admin, я хочу перевірити ролі, щоб керівник бачив команду, а представники бачили свої робочі дані.
- Як Company Admin, я хочу налаштувати базові довідники, поля і шаблон візиту, щоб tenant відповідав процесу компанії.
- Як Company Admin, я хочу налаштувати брендінг tenant, щоб інтерфейс виглядав як робочий простір компанії.

### Team Manager

- Як Team Manager, я хочу бачити dashboard команди, щоб розуміти, хто працює сьогодні і які візити вже виконані.
- Як Team Manager, я хочу призначати маршрути або плани дня представникам, щоб команда працювала за погодженим планом.
- Як Team Manager, я хочу бачити точки без покриття, щоб вчасно направляти представників.
- Як Team Manager, я хочу читати структуровані AI-підсумки візитів, щоб не переглядати довгі ручні нотатки.
- Як Team Manager, я хочу створювати задачі представникам, щоб фіксувати наступні дії.
- Як Team Manager, я хочу бачити dashboard metrics команди, щоб оцінити активність, покриття і задачі протягом пілоту.

### Company Owner / Executive

Executive stories не входять у `Team Pilot` MVP. Вони залишаються в `Business` extension/backlog і мають реалізовуватись без зміни core-сутностей tenant: users, locations, products, routes, visits, tasks, reports і tenant isolation.

### Field Representative

- Як Field Representative, я хочу бачити план на сьогодні, щоб розуміти, які точки треба відвідати.
- Як Field Representative, я хочу створити або змінити власний маршрут чи план дня на базі призначених мені локацій, щоб самостійно організувати робочий день паралельно з плануванням від Team Manager.
- Як Field Representative, я хочу швидко відкрити картку точки, щоб бачити адресу, контакти, історію і задачі.
- Як Field Representative, я хочу створити візит з картки точки або маршруту, щоб зафіксувати результат роботи.
- Як Field Representative, я хочу продиктувати або написати нотатку, щоб не витрачати час на ручний звіт.
- Як Field Representative, я хочу підтвердити AI draft перед збереженням, щоб контролювати якість даних.

## 5. MVP-функціональність

### 5.1 Tenant setup

MVP має підтримувати створення pilot tenant з такими параметрами:

- company name;
- tenant slug;
- country;
- timezone;
- language;
- segment template: `distribution`, `service` або `partner_account`;
- plan: `pilot`;
- product mode: `team`;
- database placement: `shared`;
- one or more Company Admin emails.

Optional onboarding metadata, якщо ці дані вже є після discovery:

- estimated users count;
- estimated locations count;
- onboarding notes.

Ці optional поля не є source of truth для billing, limits, permissions або product mode. Їх не треба вимагати від Platform Owner під час технічного створення tenant.

Acceptance criteria:

- tenant створюється у platform registry;
- tenant має статус `draft`, `provisioning`, `ready`, `pilot_active`, `active`, `suspended` або `archived`;
- для pilot/team за замовчуванням використовується shared DB;
- tenant отримує стартові ролі, типи точок, типи візитів, статуси задач і AI extraction template;
- один або кілька Company Admin отримують invite;
- tenant можна створити без estimated users count і estimated locations count.

### 5.2 Auth and tenant resolution

MVP має підтримувати:

- tenant URL через slug або subdomain;
- email/password login;
- invite link для першого входу;
- role-based redirect після login;
- backend tenant context для кожного API-запиту.

Acceptance criteria:

- користувач не передає `tenant_id` у body як джерело правди;
- tenant визначається з host/slug/session/token;
- користувач tenant A не може бачити дані tenant B;
- після входу Field Representative потрапляє на `Головна`;
- після входу Team Manager потрапляє на `Огляд команди`;
- після входу Company Admin потрапляє на admin overview або onboarding checklist.

### 5.3 Onboarding checklist

Checklist показує готовність tenant до запуску пілоту.

Пункти checklist:

- компанія створена;
- принаймні один адміністратор активний;
- точки імпортовані;
- продукти/SKU імпортовані або позначені як не потрібні для пілоту;
- користувачі створені;
- ролі призначені;
- керівник має full tenant view;
- шаблон візиту обраний;
- AI extraction протестований;
- перший маршрут або план дня створений;
- представники запрошені.

Acceptance criteria:

- Company Admin і Platform Owner бачать статус checklist;
- кожен пункт має статус `not_started`, `in_progress`, `done` або `skipped`;
- tenant не переходить у `pilot_active`, поки критичні пункти не завершені Company Admin або явно не пропущені Company Admin / Platform Owner під час assisted launch.

### 5.4 Imports

MVP має підтримувати assisted import для:

- locations;
- users;
- products/SKU.

Основний оператор імпорту в продукті - Company Admin. Команда Vizitum може допомагати через assisted setup / internal ops під час запуску пілоту: підготувати файл, виконати assisted conversion, запустити імпорт від імені операційної підтримки або допомогти розібрати помилки. Але правильність даних, ролей і налаштувань підтверджує Company Admin всередині tenant.

Перші формати: CSV як обов'язковий, XLSX як бажаний для pilot launch, якщо його можна підтримати без окремого складного mapping-builder. У user flows клієнт може надати стартові дані у CSV/XLSX, тому MVP має або приймати XLSX напряму, або мати assisted conversion у CSV без зміни бізнес-процесу для клієнта.

#### Locations import

Мінімальні поля:

- name;
- type;
- address;
- city;
- region;
- contact_name;
- contact_phone;
- assigned_representative_email;
- potential;
- status.

#### Users import

Мінімальні поля:

- full_name;
- email;
- phone;
- role;
- active;
- territory або region як просте поле.

#### Products import

Мінімальні поля:

- name;
- sku;
- group;
- active.

Acceptance criteria:

- імпорт має preview перед застосуванням;
- система показує помилки валідації по рядках;
- імпорт не створює записи без tenant context;
- імпорт зберігає history: хто, коли, який файл, скільки рядків успішно/з помилками;
- import history має показувати, чи імпорт виконав Company Admin напряму, чи команда Vizitum у межах assisted setup;
- дублікати email у users і дублікати name/address у locations мають бути позначені як warning або error.

### 5.5 Field Representative home

Екран `Головна` для представника показує:

- дату;
- прогрес дня;
- точки маршруту або плану;
- відкриті задачі;
- кнопку `Почати візит`;
- empty state, якщо плану немає.

Acceptance criteria:

- представник бачить тільки свої призначені точки, маршрути, візити і задачі;
- якщо плану немає, представник може перейти до списку своїх точок;
- представник може створити або змінити власний маршрут чи план дня тільки на базі призначених йому локацій;
- якщо план створений Team Manager, представник може працювати з ним або адаптувати власний план у межах правил tenant і призначених йому локацій;
- інтерфейс mobile-first і придатний для використання з телефону.

### 5.6 Locations

Картка точки показує:

- назву;
- тип;
- адресу;
- контакти;
- відповідального представника;
- статус;
- сегмент або потенціал;
- останній візит;
- наступну дію;
- відкриті задачі;
- історію візитів;
- продукти/SKU, якщо увімкнено для tenant.

Дії:

- почати візит;
- створити задачу;
- оновити базові контактні дані, якщо дозволено роллю;
- переглянути історію.

Acceptance criteria:

- Field Representative бачить свої точки;
- Team Manager бачить усі точки tenant у режимі Team;
- Company Admin може створювати, редагувати та імпортувати точки;
- кожна точка має `tenant_id`.

### 5.7 Routes and daily plan

MVP може реалізувати маршрути у простому вигляді:

- route plan на дату;
- список route stops;
- assigned representative;
- planned order;
- planned status;
- actual visit status.

Acceptance criteria:

- Team Manager створює, редагує або призначає простий план дня для представника;
- Field Representative паралельно може самостійно створити або змінити власний маршрут чи план дня тільки на базі призначених йому локацій;
- Field Representative завжди може додати позапланову призначену точку або візит з маркуванням `unplanned`;
- представник бачить свої точки на день;
- після збереження візиту статус точки у плані оновлюється;
- Company Admin налаштовує правила самостійного планування, конфліктів і базові assignment-поля, але не веде щоденне планування;
- складна оптимізація маршруту не входить у MVP.

### 5.8 Visits

Візит можна створити:

- з картки точки;
- з плану дня;
- через quick action.

Базові поля:

- location;
- representative;
- visit date/time;
- visit type;
- result status;
- raw note;
- summary;
- next action;
- presented products/SKU;
- created tasks;
- AI draft status.

Acceptance criteria:

- візит завжди належить tenant;
- Field Representative може створювати власні візити;
- Team Manager може переглядати всі візити tenant у режимі Team;
- AI output не змінює фінальний звіт без підтвердження користувача;
- raw note і final confirmed report зберігаються окремо.

### 5.9 AI visit reporting

Voice reporting є обов'язковою частиною MVP, бо GTM і пілотна обіцянка продають Vizitum як спосіб прибрати ручну вечірню звітність через голосові або текстові звіти. MVP має підтримувати обидва входи:

- текстова нотатка після візиту;
- голосова нотатка з web/PWA audio recording або upload;
- transcription голосової нотатки;
- AI extraction зі transcript або raw text;
- підтвердження structured draft користувачем.

У MVP voice не означає native mobile app, offline-first recording або складну audio UX. Достатньо надійного mobile web/PWA flow: записати або завантажити audio, отримати transcript, побачити structured draft, підтвердити або відредагувати результат.

#### Voice transcription flow

1. Field Representative натискає кнопку голосової нотатки у visit draft.
2. Додаток записує audio у підтримуваному web форматі або дозволяє upload audio.
3. Backend зберігає raw audio у tenant-scoped storage.
4. Transcription job створює transcript.
5. AI extraction job застосовує tenant-specific extraction schema.
6. Користувач бачить transcript і structured draft.
7. Користувач підтверджує, редагує або відхиляє draft.
8. Final report зберігається тільки після підтвердження користувачем.

#### AI extraction input

- tenant id з backend context;
- visit id або draft id;
- raw audio storage key, якщо візит створено з голосу;
- raw note або transcript;
- segment template;
- tenant-specific extraction schema;
- доступні products/SKU;
- поточні open tasks по точці.

#### AI extraction output

```json
{
  "summary": "Короткий підсумок візиту",
  "agreements": ["Домовленість 1"],
  "objections": ["Заперечення або проблема"],
  "mentionedProducts": [
    {
      "name": "Product name",
      "status": "presented | interested | issue | competitor_mentioned"
    }
  ],
  "nextActions": ["Наступна дія"],
  "tasksToCreate": [
    {
      "title": "Назва задачі",
      "dueDate": "2026-07-05",
      "assignee": "representative"
    }
  ],
  "locationUpdates": [
    {
      "field": "contact_phone",
      "proposedValue": "+380..."
    }
  ],
  "confidence": 0.82,
  "requiresUserConfirmation": true
}
```

Acceptance criteria:

- користувач може створити visit draft з текстової або голосової нотатки;
- голосова нотатка зберігається у tenant-scoped storage;
- transcription має статус `queued`, `processing`, `completed` або `failed`;
- якщо transcription failed, користувач може вручну ввести текстову нотатку і завершити звіт;
- AI output має статус `draft`, `confirmed`, `edited` або `discarded`;
- користувач бачить AI draft перед збереженням final report;
- задачі з AI draft створюються тільки після підтвердження;
- зміни у картці точки з AI draft застосовуються тільки після підтвердження;
- raw audio reference, raw note, transcript, AI output і final report зберігаються для audit/debug;
- logs не містять raw notes або transcripts.

### 5.10 Tasks

Задача може бути створена:

- вручну представником;
- вручну керівником;
- з AI draft після підтвердження;
- з картки точки;
- з візиту.

Базові поля:

- title;
- description;
- status;
- priority;
- due date;
- assignee;
- location;
- visit;
- created by.

Статуси:

- `open`;
- `in_progress`;
- `done`;
- `overdue`;
- `cancelled`.

Acceptance criteria:

- представник бачить свої задачі;
- керівник бачить задачі всієї команди в Team;
- задача може бути прив'язана до точки і візиту;
- прострочені задачі відображаються у manager dashboard.

### 5.11 Manager dashboard

Dashboard керівника у MVP показує:

- активні представники сьогодні;
- представники без плану на сьогодні;
- план/факт візитів;
- візити за день/тиждень;
- відкриті задачі;
- прострочені задачі;
- точки без візитів за період;
- точки з високим потенціалом без покриття;
- останні AI-підсумки;
- активність по представниках.

Acceptance criteria:

- Team Manager бачить full tenant view у режимі Team;
- дані dashboard фільтруються за датою або періодом;
- кожен показник має drill-down до списку візитів, точок, задач або представників;
- dashboard не показує дані інших tenants.

### 5.12 Pilot review

Pilot review формується після 7-10 днів використання.

Метрики:

- кількість активних представників;
- кількість створених візитів;
- кількість AI-оброблених звітів;
- кількість confirmed AI drafts;
- кількість створених задач;
- кількість закритих задач;
- кількість покритих точок;
- точки з високим потенціалом без покриття;
- перегляди dashboard керівником;
- повторювані заперечення;
- проблемні продукти/SKU;
- наступні дії.

Default success thresholds для 7-10 денного пілоту:

- мінімум 70% запрошених Field Representatives активні, тобто створили хоча б один візит або виконали одну задачу;
- мінімум 3 дні використання протягом першого робочого тижня для активних представників;
- мінімум 50 створених візитів на pilot tenant або мінімум 5 візитів на активного представника, якщо команда менша;
- мінімум 60% візитів мають AI draft, створений з голосової або текстової нотатки;
- мінімум 50% AI drafts підтверджені або відредаговані користувачем, а не відхилені;
- Team Manager відкрив dashboard мінімум 3 рази протягом пілоту;
- створено мінімум 10 задач або follow-up actions, якщо сценарій пілоту передбачає задачі;
- клієнт може назвати щонайменше 3 управлінські інсайти з dashboard або AI summaries: точки без покриття, повторювані заперечення, проблемні продукти/SKU, прострочені задачі або наступні дії.

Пороги можна адаптувати під розмір команди і сегмент до старту пілоту, але вони мають бути зафіксовані в pilot setup. Після старту пілоту success criteria не змінюються, щоб review залишався чесним decision point, а не ретроспективним поясненням.

Acceptance criteria:

- Company Admin може відкрити і запустити pilot review за період;
- review можна експортувати або скопіювати у короткий summary;
- метрики базуються на реальних сутностях продукту, а не ручному введенні;
- pilot review показує, які success thresholds виконані, не виконані або не застосовуються до конкретного пілоту.

## 6. MVP segment templates

MVP має підтримувати три production-ready templates для перших продажів, демо і пілотів:

- `distribution / trade reps`;
- `service / field operations`;
- `partner / account visits`.

Всі templates використовують однакові core-сутності: users, locations, products, routes, visits, tasks, reports і AI extraction. Різниця між templates має бути конфігураційною: назви сутностей, стартові поля, типи візитів, KPI, dashboard preset і AI prompt/schema preset.

Щоб template вважався production-ready для MVP, він має мати:

- стартові labels і терміни інтерфейсу;
- типи точок і типи візитів;
- result statuses;
- мінімальні обов'язкові поля location/visit;
- dashboard KPI preset;
- AI extraction schema/prompt preset;
- demo data для sales/demo;
- checklist перевірки після tenant seed.

### Template 1: distribution / trade reps

#### Мова інтерфейсу

Базові терміни:

- точка;
- торгова точка;
- представник;
- маршрут;
- візит;
- продукт;
- SKU;
- задача;
- покриття.

#### Типи точок

- магазин;
- аптека;
- партнер;
- клієнт;
- дистриб'юторська точка;
- інше.

#### Типи візитів

- плановий візит;
- повторний візит;
- follow-up;
- презентація продукту;
- перевірка наявності;
- проблемний візит.

#### Result statuses

- completed;
- no_contact;
- postponed;
- issue_found;
- follow_up_required.

#### Базові KPI

- візити за день;
- план/факт візитів;
- покриті точки;
- точки без покриття;
- відкриті задачі;
- прострочені задачі;
- AI-структуровані звіти;
- активність по представниках;
- згадані продукти/SKU.

### Template 2: service / field operations

#### Мова інтерфейсу

Базові терміни:

- об'єкт;
- клієнт;
- сервісний представник;
- заявка;
- візит;
- роботи;
- SLA;
- задача;
- повторний візит.

#### Типи точок

- об'єкт;
- клієнт;
- обладнання;
- локація обслуговування;
- партнерський об'єкт;
- інше.

#### Типи візитів

- планове обслуговування;
- аварійний виїзд;
- діагностика;
- повторний візит;
- закриття заявки;
- контроль якості.

#### Result statuses

- completed;
- issue_found;
- requires_follow_up;
- parts_required;
- client_unavailable;
- escalated.

#### Базові KPI

- виконані візити за день;
- відкриті заявки;
- прострочені задачі;
- SLA risk;
- повторні звернення;
- об'єкти без візиту за період;
- середній час до закриття задачі;
- AI-структуровані звіти;
- повторювані проблеми.

### Template 3: partner / account visits

#### Мова інтерфейсу

Базові терміни:

- партнер;
- клієнт;
- account;
- представник;
- зустріч;
- домовленість;
- наступна дія;
- задача;
- потенціал.

#### Типи точок

- партнер;
- клієнт;
- key account;
- мережа;
- офіс;
- інше.

#### Типи візитів

- планова зустріч;
- follow-up;
- презентація;
- переговори;
- узгодження умов;
- проблемна зустріч.

#### Result statuses

- completed;
- agreement_reached;
- follow_up_required;
- objection_received;
- postponed;
- no_decision.

#### Базові KPI

- зустрічі за день/тиждень;
- активність по партнерах;
- виконання домовленостей;
- відкриті follow-up задачі;
- прострочені next actions;
- партнери без контакту за період;
- потенційні партнери без покриття;
- AI-структуровані звіти;
- повторювані заперечення.

## 7. Доменна модель MVP

### Platform-level entities

- `Tenant`
- `TenantStatus`
- `TenantPlan`
- `TenantPlacement`
- `ProvisioningJob`
- `PlatformUser`
- `ImportJob`
- `AuditEvent`

### Tenant-owned entities

- `User`
- `Role`
- `Location`
- `Product`
- `ProductGroup`
- `Route`
- `RoutePlan`
- `RouteStop`
- `Visit`
- `VisitProduct`
- `VisitNote`
- `VisitAudioAttachment`
- `TranscriptionJob`
- `AiExtraction`
- `Task`
- `DashboardViewEvent`
- `PilotReview`

### Tenant isolation rules

- Усі tenant-owned таблиці мають `tenant_id`.
- API не приймає `tenant_id` з client body як джерело правди.
- Tenant context формується після tenant resolution і auth.
- Background jobs завжди мають явний tenant context.
- AI jobs не мають доступу до даних інших tenants.
- Manager dashboard у Team показує тільки дані поточного tenant.

## 8. Permissions matrix MVP

Матриця нижче описує базові права окремої ролі. Якщо користувач має кілька ролей, його effective permissions є сумою прав цих ролей. Наприклад, `Company Admin + Team Manager` не бачить team dashboard як Company Admin, але бачить його через роль Team Manager; `Team Manager + Field Representative` може і керувати командою, і проходити власний mobile-first daily flow.

`Full tenant view` для Team Manager означає read access до операційних даних tenant. Права створення, редагування, імпорту, tenant settings або role management надаються окремо й не випливають автоматично з full tenant view.

| Дія | Company Admin | Team Manager | Field Representative | Executive / Business |
| --- | --- | --- | --- | --- |
| Бачити dashboard команди | Ні, тільки admin overview | Так | Ні | Так, high-level |
| Бачити всі точки tenant | Так | Так у Team / scope у Business | Ні | Так або scope |
| Бачити свої точки | Так | Так | Так | Ні |
| Створювати точки | Так | Опційно | Ні | Ні |
| Редагувати точки | Так | Опційно | Обмежено | Ні |
| Імпортувати точки | Так | Ні | Ні | Ні |
| Бачити всі візити tenant | Ні, крім audit/support за окремим правом | Так у Team / scope у Business | Ні | Так або scope |
| Бачити свої візити | Ні | Так | Так | Ні |
| Створювати власні візити | Ні | Так | Так | Ні |
| Редагувати чужі візити | Ні | Обмежено | Ні | Ні |
| Створювати план дня для представника | Ні | Так | Для себе, з призначених локацій | Ні |
| Змінювати власний план дня | Ні | Так | Так, у межах призначених локацій | Ні |
| Призначати маршрути представникам | Ні | Так | Ні | Ні |
| Додавати позапланову точку або візит | Ні | Так | Так, якщо точка призначена представнику | Ні |
| Створювати задачі | Ні | Так | Так | Ні |
| Призначати задачі іншим | Ні | Так | Ні | Ні |
| Імпортувати користувачів | Так | Ні | Ні | Ні |
| Призначати ролі | Так, включно із собою | Ні | Ні | Ні |
| Налаштовувати шаблон візиту | Так | Ні | Ні | Ні |
| Запускати pilot review | Так | Ні | Ні | Ні |
| Бачити executive dashboard | Ні | Ні | Ні | Так |

Колонка `Executive / Business` не є частиною `Team Pilot` implementation scope. Вона залишена як сумісність з user flow документом і як нагадування, що Business capabilities мають бути розширенням того самого permissions model, а не окремим продуктом.

## 9. Екрани MVP

### Platform / Operations

- Tenant list.
- Create tenant.
- Tenant detail.
- Provisioning, migration and import job status.
- Pilot monitoring metrics.

Повна Platform Console може бути спрощена в першій версії, але функції tenant setup і pilot monitoring мають існувати хоча б через внутрішній admin flow. Platform Owner створює tenant і запрошує одного або кількох Company Admin, але не виконує регулярне адміністрування користувачів, ролей, маршрутів або довідників клієнта.

### Company Admin

- Onboarding checklist.
- Admin overview.
- Users.
- Locations.
- Products/SKU.
- Imports.
- Visit template settings.
- Branding.
- Tenant settings.
- Pilot review.

### Team Manager

- Team overview.
- Visits.
- Tasks.
- Locations.
- Representatives.

### Company Owner / Executive

Окремий MVP-екран не є обов'язковим для `Team`. Для `Business` або post-MVP:

- Executive Dashboard.
- Company / region / team analytics.
- Coverage.
- AI summaries.
- Management reports export.

### Field Representative

- Home / today.
- Route or daily plan.
- Location card.
- Visit form.
- AI draft confirmation.
- Tasks.
- Visit history.

## 10. API-зони MVP

### Platform API

- `POST /api/platform/tenants`
- `GET /api/platform/tenants`
- `GET /api/platform/tenants/{tenantId}`
- `POST /api/platform/tenants/{tenantId}/assisted-imports`
- `GET /api/platform/tenants/{tenantId}/assisted-imports`
- `GET /api/platform/tenants/{tenantId}/import-jobs`

Platform import endpoints не є основним API для імпорту клієнтських даних. Вони потрібні тільки для assisted setup / internal ops: підготовка файлу, assisted conversion, запуск або моніторинг import job від імені операційної підтримки. Основний product flow для імпорту точок, користувачів і продуктів/SKU проходить через Tenant API з роллю Company Admin.

### Tenant API

- `GET /api/me/workspace`
- `GET /api/onboarding/checklist`
- `PATCH /api/onboarding/checklist/{itemId}`
- `GET /api/locations`
- `POST /api/locations`
- `GET /api/locations/{id}`
- `PATCH /api/locations/{id}`
- `GET /api/products`
- `POST /api/products`
- `GET /api/imports`
- `POST /api/imports/locations`
- `POST /api/imports/users`
- `POST /api/imports/products`
- `GET /api/imports/{jobId}`
- `POST /api/imports/{jobId}/confirm`
- `GET /api/route-plans/{date}`
- `POST /api/route-plans`
- `GET /api/visits`
- `POST /api/visits`
- `GET /api/visits/{id}`
- `PATCH /api/visits/{id}`
- `POST /api/visit-drafts/{id}/audio`
- `POST /api/visit-drafts/{id}/transcribe`
- `GET /api/visit-drafts/{id}/transcription-status`
- `POST /api/visit-drafts/ai-extract`
- `POST /api/visits/{id}/confirm-ai-draft`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/{id}`
- `GET /api/manager/dashboard`
- `GET /api/admin/pilot-review`
- `POST /api/admin/pilot-review/run`

Tenant import endpoints мають вимагати tenant context із session/token/host і роль Company Admin. `POST /api/imports/*` створює preview/import job, а `POST /api/imports/{jobId}/confirm` застосовує імпорт після preview та валідації.

## 11. Non-functional requirements

### Security and privacy

- Tenant isolation є критичною вимогою MVP.
- Raw audio, raw notes, transcripts і AI outputs не пишуться у logs.
- Усі storage paths мають бути tenant-scoped.
- Усі exports мають перевіряти роль і tenant context.
- Audit events мають фіксувати створення, редагування і підтвердження критичних сутностей.

### Performance

MVP має комфортно працювати для tenant з:

- 5-30 представниками;
- до 500 точок у pilot;
- до 5 000 точок у Team після пілоту;
- до 10 000 візитів у ранній production-фазі.

### Reliability

- AI extraction має бути асинхронною або мати retry strategy.
- Imports мають мати статуси і зрозумілу помилку.
- Failed AI job не має блокувати ручне збереження візиту.
- Failed import не має частково псувати production data без history.

### Observability

Потрібно бачити:

- API errors;
- auth errors;
- import failures;
- audio storage failures;
- transcription failures;
- AI extraction failures;
- job queue status;
- tenant-specific error grouping без витоку бізнес-даних.

## 12. QA-сценарії MVP

### Tenant isolation

1. Створити tenant A і tenant B.
2. Додати користувачів, точки і візити в обидва tenants.
3. Увійти користувачем tenant A.
4. Переконатися, що API не повертає дані tenant B.
5. Спробувати звернутися до entity id з tenant B.
6. Переконатися, що відповідь `404` або `403`.

### Pilot setup

1. Створити pilot tenant.
2. Обрати segment template `distribution`, `service` або `partner_account`.
3. Запросити одного або кількох Company Admin.
4. Імпортувати або підтвердити точки, користувачів і продукти як Company Admin; якщо потрібен assisted setup, команда Vizitum може допомогти з підготовкою або запуском імпорту.
5. Перевірити onboarding checklist.
6. Запросити Team Manager і Field Representative.
7. Перевести tenant у `pilot_active`.

### Representative daily flow

1. Увійти як Field Representative.
2. Відкрити `Головна`.
3. Перейти до точки з плану.
4. Почати візит.
5. Записати голосову нотатку.
6. Дочекатися transcript або побачити статус обробки.
7. Запустити AI extraction зі transcript.
8. Перевірити AI draft.
9. Підтвердити або відредагувати draft.
10. Зберегти візит.
11. Переконатися, що задача з draft створена тільки після підтвердження.
12. Повторити flow з текстовою нотаткою як fallback або альтернативний шлях.

### Manager flow

1. Увійти як Team Manager.
2. Відкрити `Огляд команди`.
3. Перевірити активність представників.
4. Відкрити список візитів.
5. Перейти у конкретний візит.
6. Переглянути AI summary.
7. Створити follow-up задачу.
8. Перевірити, що задача відображається представнику.

### Pilot review

1. Створити тестові візити за 7-10 днів.
2. Додати AI-confirmed reports.
3. Створити і закрити кілька задач.
4. Увійти як Company Admin.
5. Відкрити pilot review.
6. Переконатися, що метрики відповідають фактичним даним.

## 13. Implementation phases

### Phase 0: Foundation

- Repo/app structure.
- Auth.
- Tenant registry.
- Shared tenant DB schema.
- Roles.
- Tenant-aware API context.
- Basic audit events.
- Tenant isolation tests.

### Phase 1: Core field flow

- Users.
- Locations.
- Products/SKU.
- Simple route plan.
- Representative home.
- Location card.
- Visit creation.
- Tasks.

### Phase 2: AI visit reporting

- Visit draft.
- Text note extraction.
- Voice note recording або upload.
- Tenant-scoped audio storage.
- Transcription job.
- AI extraction schema.
- Confirmation UI.
- AI output audit.

### Phase 3: Manager view

- Team dashboard.
- Visit list.
- Task list.
- Location coverage.
- Representative activity.
- Drill-down screens.

### Phase 4: Pilot operations

- Imports.
- Onboarding checklist.
- Pilot review metrics.
- Export or copyable pilot summary.
- Basic operations monitoring.

## 14. Open product decisions

Ці питання не блокують старт технічного дизайну, але їх варто закрити до активної реалізації відповідних модулів:

- Який саме browser audio format використовуємо у mobile web/PWA для першого voice flow?
- Які поля location є обов'язковими для кожного MVP template?
- Чи потрібен експорт pilot review у PDF/CSV, чи достатньо dashboard і copyable summary?
- Яка мінімальна юридична згода потрібна для обробки голосових нотаток і AI processing?

Вже узгоджені рішення з user flow:

- Audio upload дозволяється як fallback до browser recording.
- CSV є обов'язковим import format; XLSX має підтримуватись напряму або через assisted conversion у CSV для launch.
- Field Representative у MVP працює з призначеними точками, може створювати або змінювати власний route/daily plan тільки на базі призначених йому локацій і може додати позапланову призначену точку/візит у план, але створення нової master location не є базовим правом.
- Team Manager у `Team` створює, редагує і призначає прості route/daily plans паралельно з самостійним плануванням Field Representative у межах призначених йому локацій, а також створює задачі і переглядає точки; редагування master data по точках лишається Company Admin або окремим дозволом.
- Executive role і Executive Dashboard залишаються Business/post-MVP scope, не частина `Team Pilot`.

## 15. Definition of done для MVP

MVP можна вважати готовим до першого реального пілоту, якщо:

- можна створити pilot tenant у shared DB;
- можна імпортувати точки, користувачів і продукти;
- можна обрати і застосувати production-ready template для `distribution`, `service` або `partner_account`;
- Company Admin може перевірити onboarding checklist;
- представник може пройти повний daily flow з візитом;
- представник може створити звіт через голосову нотатку, transcript і AI draft;
- представник може створити звіт через текстову нотатку як fallback;
- AI draft створюється і підтверджується користувачем;
- задачі створюються і відображаються відповідальним;
- керівник бачить dashboard команди;
- pilot review показує базові usage metrics;
- pilot review показує success thresholds і статус виконання кожного порогу;
- tenant isolation покрита integration tests;
- жоден API-запит не дозволяє отримати дані іншого tenant;
- logs не містять raw notes, transcripts або чутливі бізнес-дані;
- основні QA-сценарії проходять вручну або автоматизовано.
