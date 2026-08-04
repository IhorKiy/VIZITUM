// Canonical public origin of the marketing site. Used for SEO surfaces
// (canonical URL, robots.txt, sitemap.xml) which must always point at the
// production domain regardless of the deployment's own host.
export const SITE_URL = "https://www.vizitum.com";

// The inbox a stranger writes to from the marketing landing. Deliberately a
// role address rather than a person's: it is routed (Cloudflare Email Routing
// on the vizitum.com zone) and can be re-pointed without touching the page it
// is printed on. Not a translated string — it is the same address in both
// landing languages, so it lives here and only the copy around it comes from
// the dictionaries.
export const CONTACT_EMAIL = "support@vizitum.com";
