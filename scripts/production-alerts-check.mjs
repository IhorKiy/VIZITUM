const requiredUrls = [
  {
    name: "API readiness endpoint",
    envName: "API_READINESS_URL",
    validator: validateReadiness,
  },
];

const optionalUrls = [
  {
    name: "Frontend web app",
    envName: "WEB_URL",
    validator: validateOkResponse,
  },
  {
    name: "Operations summary endpoint",
    envName: "OPERATIONS_SUMMARY_URL",
    validator: validateOperationsSummary,
  },
];

const bearerToken = process.env.OPERATIONS_SUMMARY_BEARER_TOKEN?.trim();

for (const check of requiredUrls) {
  if (!process.env[check.envName]?.trim()) {
    fail(`${check.envName} is required.`);
  }
}

for (const check of [...requiredUrls, ...optionalUrls]) {
  const url = process.env[check.envName]?.trim();

  if (!url) {
    console.log(`Skipping ${check.name}. Set ${check.envName} to enable it.`);
    continue;
  }

  await runUrlCheck(check.name, url, check.validator);
}

console.log("\nProduction alerts endpoint checks completed.");
console.log("Record provider alert evidence in docs/runbooks/production-alerts.md.");

async function runUrlCheck(name, url, validator) {
  console.log(`\n==> ${name}`);
  console.log(url);

  let response;

  try {
    response = await fetch(url, {
      headers: buildHeaders(url),
      redirect: "follow",
    });
  } catch (error) {
    fail(`${name} request failed: ${readError(error)}`);
  }

  await validator(name, response);
}

function buildHeaders(url) {
  if (!bearerToken || url !== process.env.OPERATIONS_SUMMARY_URL?.trim()) {
    return undefined;
  }

  return {
    Authorization: `Bearer ${bearerToken}`,
  };
}

async function validateOkResponse(name, response) {
  if (!response.ok) {
    fail(`${name} returned HTTP ${response.status}.`);
  }

  console.log(`OK: HTTP ${response.status}`);
}

async function validateReadiness(name, response) {
  const body = await readJson(response, name);

  if (!response.ok || body.status !== "ready") {
    fail(
      `${name} must return HTTP 2xx and status="ready". Got HTTP ${response.status}, status=${JSON.stringify(
        body.status,
      )}.`,
    );
  }

  const databaseStatus = body.checks?.database?.status;
  const environmentStatus = body.checks?.criticalEnvironment?.status;

  if (databaseStatus !== "ok" || environmentStatus !== "ok") {
    fail(
      `${name} readiness checks are not healthy: database=${JSON.stringify(
        databaseStatus,
      )}, criticalEnvironment=${JSON.stringify(environmentStatus)}.`,
    );
  }

  console.log("OK: readiness is ready.");
}

async function validateOperationsSummary(name, response) {
  const body = await readJson(response, name);

  if (!response.ok) {
    fail(`${name} returned HTTP ${response.status}.`);
  }

  const requiredSections = [
    "tenants",
    "provisioning",
    "imports",
    "ai",
    "storage",
  ];
  const missingSections = requiredSections.filter(
    (section) => !(section in body),
  );

  if (missingSections.length > 0) {
    fail(`${name} is missing sections: ${missingSections.join(", ")}.`);
  }

  console.log("OK: operations summary returned aggregate counters.");
}

async function readJson(response, name) {
  try {
    return await response.json();
  } catch (error) {
    fail(`${name} did not return valid JSON: ${readError(error)}`);
  }
}

function readError(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
