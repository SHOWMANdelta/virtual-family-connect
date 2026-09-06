/**
 * Email delivery preflight.
 *
 *   pnpm check:email                          # check the dev deployment
 *   pnpm check:email --prod                   # check production
 *   pnpm check:email --send-to=you@gmail.com  # ...and send a real test message
 *
 * Answers the one question `resolveEmailConfig()` structurally cannot: will a
 * sign-in code actually reach a stranger's inbox?
 *
 * The distinction matters because the failure is silent and asymmetric. Holding an
 * API key is not permission to email other people — every provider makes you prove
 * you control the address you send *from*, and until you do, sends either bounce
 * for everyone or (worse, with Resend's shared test sender) succeed for the account
 * owner and 403 for every real user. The app cannot tell those apart from
 * `process.env` alone, so it warns pessimistically at sign-in. This script asks the
 * provider directly and gives a definite answer instead.
 *
 * Exits non-zero when mail would not reach arbitrary recipients, so it works as a
 * pre-deploy gate.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const argv = process.argv.slice(2);

/**
 * Product name, duplicated from BRAND_NAME in src/convex/emailTemplates.ts for
 * the same reason `parseSender` below is duplicated: that file is TypeScript for
 * the Convex runtime and this is plain Node. Keep the two in step — this string
 * is the sender name the script reports and tests with.
 */
const BRAND = "Virtual Family Connect";

const sendToArg = argv.find((a) => a.startsWith("--send-to="));
const testRecipient = sendToArg?.slice("--send-to=".length).trim();

// Forwarded verbatim to every `convex env` call so one flag targets one
// deployment. The Convex CLI spells this `--deployment-name <name>` (checked
// against `convex env set --help`); `--deployment` is silently not a flag it
// knows, so accept both spellings from the user and always emit the real one.
const target = [];
if (argv.includes("--prod")) target.push("--prod");
const deploymentIndex = argv.findIndex(
  (a) => a === "--deployment-name" || a === "--deployment",
);
if (deploymentIndex !== -1 && argv[deploymentIndex + 1]) {
  target.push("--deployment-name", argv[deploymentIndex + 1]);
}

const label = target.length === 0 ? "dev" : target.join(" ");

// ---------------------------------------------------------------------------
// Convex CLI plumbing
// ---------------------------------------------------------------------------

// Same approach as setup-auth.mjs, and for the same reason: spawning `npx.cmd`
// fails with EINVAL on Windows under Node 20+, so resolve the CLI's JS entry
// point and run it with the current node binary. The bin script isn't in the
// package's `exports` map, so resolve package.json (which is) and walk to the
// path `bin` declares.
const require = createRequire(import.meta.url);
let convexCli;
try {
  const pkgPath = require.resolve("convex/package.json");
  const bin = JSON.parse(readFileSync(pkgPath, "utf8")).bin?.convex;
  if (!bin) throw new Error("convex package declares no `convex` bin");
  convexCli = join(dirname(pkgPath), bin);
} catch (error) {
  console.error(
    `Couldn't find the Convex CLI (${error.message}). Run \`pnpm install\` first.`,
  );
  process.exit(1);
}

function convex(commandArgs) {
  return execFileSync(process.execPath, [convexCli, ...commandArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Read one variable, or undefined when it isn't set.
 *
 * Deliberately one `env get` per name rather than one `env list`. `convex env
 * list` prints every variable's full *value*, which on this deployment means
 * dumping JWT_PRIVATE_KEY — the key that signs auth tokens — into this process's
 * buffers and onto the terminal. Asking for exactly the five names below means
 * the signing key is never read at all.
 *
 * A missing variable exits 0 with empty stdout and a message on stderr (checked
 * against the CLI), so empty output is an unambiguous "not set".
 */
function envValue(name) {
  try {
    const value = convex(["env", "get", name, ...target]).trim();
    return value === "" ? undefined : value;
  } catch (error) {
    // A hard failure here means the deployment itself is unreachable — wrong
    // account, not logged in, or no such deployment. Every later check would
    // report a misleading "not configured", so stop on the real cause.
    console.error(
      `\nCouldn't read the ${label} deployment's environment.\n` +
        (target.length === 0
          ? "Start it in another terminal with:  npx convex dev\n"
          : "Check that the deployment exists and you're logged in\n" +
            "(`npx convex login`), and that this directory is linked to it.\n"),
    );
    console.error(error.stderr || error.message);
    process.exit(1);
  }
}

/**
 * Whether a variable is set, without surfacing its value.
 *
 * For the signing keys only presence matters. The value is reduced to a boolean
 * in one expression and never stored, printed, or returned — the hazard worth
 * avoiding is a secret reaching the terminal or a saved log, which is precisely
 * what `convex env list` does.
 */
function envIsSet(name) {
  return envValue(name) !== undefined;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const PASS = "  OK   ";
const WARN = " WARN  ";
const FAIL = " FAIL  ";

function line(status, message) {
  console.log(`[${status}] ${message}`);
}

function heading(text) {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/**
 * Split `Name <addr@example.com>` or a bare address.
 *
 * Deliberately duplicates `parseSender` in src/convex/emailDelivery.ts rather than
 * importing it: that file is TypeScript compiled for the Convex runtime, and this
 * is a plain Node script. Keep the two regexes in step — a mismatch here would
 * report a sender the app doesn't actually use.
 */
function parseSender(raw) {
  const value = raw.trim();
  const angled = value.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>$/);
  if (angled) {
    const name = angled[1].trim().replace(/^"(.*)"$/, "$1").trim();
    return { name: name || BRAND, email: angled[2].trim() };
  }
  if (/^[^<>\s]+@[^<>\s]+$/.test(value)) {
    return { name: BRAND, email: value };
  }
  return null;
}

async function readJson(response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw.slice(0, 300) };
  }
}

// ---------------------------------------------------------------------------
// Resolve configuration — mirrors resolveEmailConfig() in emailDelivery.ts
// ---------------------------------------------------------------------------

heading(`Email delivery check (${label} deployment)`);

const brevoKey = envValue("BREVO_API_KEY");
const resendKey = envValue("RESEND_API_KEY") ?? envValue("AUTH_RESEND_KEY");
const forced = envValue("EMAIL_PROVIDER")?.toLowerCase();
const fromRaw = envValue("EMAIL_FROM");
const devLog = envValue("EMAIL_DEV_LOG") === "true";
const siteUrl = envValue("SITE_URL");

let provider;
let apiKey;
if (forced === "resend" || forced === "brevo") {
  provider = forced;
  apiKey = forced === "resend" ? resendKey : brevoKey;
} else if (brevoKey) {
  provider = "brevo";
  apiKey = brevoKey;
} else if (resendKey) {
  provider = "resend";
  apiKey = resendKey;
}

// Auth signing keys are a prerequisite for sign-in regardless of email, and their
// absence produces an error that looks nothing like a mail problem — so surface it
// here rather than letting it be debugged as one.
if (!envIsSet("JWT_PRIVATE_KEY") || !envIsSet("JWKS")) {
  line(FAIL, "JWT_PRIVATE_KEY / JWKS are not set — sign-in cannot work at all.");
  console.log(
    `         Fix: node setup-auth.mjs ${target.join(" ")}`.trimEnd(),
  );
} else {
  line(PASS, "Auth signing keys are installed (JWT_PRIVATE_KEY, JWKS).");
}

if (siteUrl) {
  line(PASS, `SITE_URL is ${siteUrl}`);
} else {
  line(WARN, "SITE_URL is not set — invite links and OAuth redirects will break.");
}

const isLoopback = siteUrl
  ? /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(
      siteUrl.replace(/\/+$/, ""),
    )
  : false;

if (!provider || !apiKey) {
  if (devLog) {
    line(
      WARN,
      "No provider key set; EMAIL_DEV_LOG=true, so codes print to the convex log.",
    );
    if (!isLoopback) {
      line(
        FAIL,
        "EMAIL_DEV_LOG is on for a NON-LOCAL deployment. Working sign-in codes are",
      );
      console.log(
        "         being written to a log stream instead of being emailed. Remove it:",
      );
      console.log(
        `         npx convex env remove EMAIL_DEV_LOG ${target.join(" ")}`.trimEnd(),
      );
    }
  } else {
    line(FAIL, "No email provider is configured. Sign-in codes cannot be sent.");
  }
  console.log(
    [
      "",
      "To configure Brevo (verifies a single address, so no domain needed):",
      "  1. Sign up at https://www.brevo.com and create an API key.",
      "  2. Under Senders, add an address you own and click the link it emails you.",
      `  3. npx convex env set BREVO_API_KEY xkeysib-xxxxxxxx ${target.join(" ")}`.trimEnd(),
      `  4. npx convex env set EMAIL_FROM "${BRAND} <you@gmail.com>" ${target.join(" ")}`.trimEnd(),
      "  5. Re-run this check.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

line(PASS, `Provider: ${provider}${forced ? " (forced by EMAIL_PROVIDER)" : ""}`);

if (devLog) {
  line(
    WARN,
    "EMAIL_DEV_LOG is set but a provider key exists, so it is doing nothing.",
  );
}

const sender = parseSender(fromRaw ?? `${BRAND} <onboarding@resend.dev>`);

if (provider === "brevo" && !fromRaw) {
  line(FAIL, "EMAIL_FROM is required for Brevo — every sender must be verified.");
  console.log(
    `         npx convex env set EMAIL_FROM "${BRAND} <you@gmail.com>" ${target.join(" ")}`.trimEnd(),
  );
  process.exit(1);
}

if (!sender) {
  line(
    FAIL,
    `EMAIL_FROM is malformed: ${fromRaw} — expected \`Name <you@example.com>\`.`,
  );
  process.exit(1);
}

line(PASS, `Sender: ${sender.name} <${sender.email}>`);

// ---------------------------------------------------------------------------
// Ask the provider whether that sender is actually authorised
// ---------------------------------------------------------------------------

/** Set to false by any check proving mail won't reach arbitrary recipients. */
let reachesAnyone = true;

/** Shared handling for the auth failures both providers can return. */
function reportKeyRejected(status, body) {
  line(
    FAIL,
    `The ${provider} API key was rejected (HTTP ${status}: ${body.message ?? "no detail"}).`,
  );
  console.log("         The key is wrong, revoked, or from a different account.");
  reachesAnyone = false;
}

if (provider === "brevo") {
  heading("Brevo sender verification");

  let response;
  try {
    response = await fetch("https://api.brevo.com/v3/senders", {
      headers: { Accept: "application/json", "api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    line(FAIL, `Couldn't reach the Brevo API: ${error.message}`);
    process.exit(1);
  }

  const body = await readJson(response);

  if (response.status === 401) {
    reportKeyRejected(response.status, body);
  } else if (!response.ok) {
    line(FAIL, `Brevo returned HTTP ${response.status}: ${body.message ?? ""}`);
    reachesAnyone = false;
  } else {
    // Documented shape: { senders: [{ id, name, email, active, ips }] }.
    // `active: true` is Brevo's verified/activated flag.
    const senders = Array.isArray(body.senders) ? body.senders : [];
    const match = senders.find(
      (s) =>
        typeof s?.email === "string" &&
        s.email.toLowerCase() === sender.email.toLowerCase(),
    );

    if (!match) {
      line(FAIL, `${sender.email} is not a sender on this Brevo account.`);
      console.log(
        "         Every send will be rejected as EMAIL_SENDER_UNVERIFIED.",
      );
      console.log(
        "         Add it at https://app.brevo.com/senders/list and confirm the email.",
      );
      if (senders.length > 0) {
        console.log("\n         Senders that do exist on this account:");
        for (const s of senders) {
          console.log(
            `           ${s.active ? "verified  " : "UNVERIFIED"}  ${s.email}`,
          );
        }
        console.log(
          "\n         To use one of the verified addresses above instead:",
        );
        console.log(
          `           npx convex env set EMAIL_FROM "${BRAND} <address>" ${target.join(" ")}`.trimEnd(),
        );
      } else {
        console.log("         This account has no senders configured at all.");
      }
      reachesAnyone = false;
    } else if (!match.active) {
      line(FAIL, `${sender.email} exists on the account but is NOT verified.`);
      console.log(
        "         Brevo emailed a confirmation link when it was added — click it.",
      );
      console.log(
        "         Until then every send is rejected as EMAIL_SENDER_UNVERIFIED.",
      );
      reachesAnyone = false;
    } else {
      line(PASS, `${sender.email} is a VERIFIED Brevo sender.`);
      line(PASS, "Sign-in codes will reach any recipient address.");
    }
  }

  // Quota. A Brevo free account is 300 emails/day; running dry returns a 429 that
  // the app treats as terminal (EMAIL_QUOTA_EXCEEDED), so it's worth seeing.
  try {
    const accountResponse = await fetch("https://api.brevo.com/v3/account", {
      headers: { Accept: "application/json", "api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (accountResponse.ok) {
      const account = await readJson(accountResponse);
      const plans = Array.isArray(account.plan) ? account.plan : [];
      const emailPlan =
        plans.find((p) => p?.creditsType === "sendLimit") ?? plans[0];
      if (emailPlan) {
        line(
          PASS,
          `Plan: ${emailPlan.type ?? "unknown"}${
            emailPlan.credits !== undefined
              ? ` — ${emailPlan.credits} sending credits remaining`
              : ""
          }`,
        );
      }
      if (account.email) {
        line(PASS, `Brevo account: ${account.email}`);
      }
    }
  } catch {
    // Quota is informational only; never fail the check on it.
  }
} else {
  heading("Resend domain verification");

  if (sender.email.toLowerCase().endsWith("@resend.dev")) {
    line(FAIL, "EMAIL_FROM is on Resend's shared test domain (@resend.dev).");
    console.log(
      "         This delivers ONLY to the address that owns the Resend account.",
    );
    console.log(
      "         Every other recipient gets an HTTP 403. This is the single most",
    );
    console.log(
      "         common way sign-in looks fine in testing and is broken for users.",
    );
    console.log(
      "         Either verify a domain, or switch to Brevo (no domain needed).",
    );
    reachesAnyone = false;
  }

  let response;
  try {
    response = await fetch("https://api.resend.com/domains", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "VirtualFamilyConnect/1.0 (+check-email)",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    line(FAIL, `Couldn't reach the Resend API: ${error.message}`);
    process.exit(1);
  }

  const body = await readJson(response);

  if (response.status === 401 || response.status === 403) {
    reportKeyRejected(response.status, body);
  } else if (!response.ok) {
    line(FAIL, `Resend returned HTTP ${response.status}: ${body.message ?? ""}`);
    reachesAnyone = false;
  } else {
    const domains = Array.isArray(body.data) ? body.data : [];
    const senderDomain = sender.email.split("@")[1]?.toLowerCase();
    const match = domains.find(
      (d) => typeof d?.name === "string" && d.name.toLowerCase() === senderDomain,
    );

    if (!match) {
      if (senderDomain !== "resend.dev") {
        line(FAIL, `${senderDomain} is not registered on this Resend account.`);
        reachesAnyone = false;
      }
      if (domains.length > 0) {
        console.log("\n         Domains on this account:");
        for (const d of domains) {
          console.log(`           ${d.status}  ${d.name}`);
        }
      }
    } else if (match.status !== "verified") {
      line(FAIL, `${senderDomain} is registered but its status is "${match.status}".`);
      console.log(
        "         Publish the DKIM/SPF records Resend generated. Note SPF is a TXT",
      );
      console.log(
        "         record, not the MX — mixing those up is the usual reason this",
      );
      console.log("         sits at Pending.");
      reachesAnyone = false;
    } else {
      line(PASS, `${senderDomain} is VERIFIED on Resend.`);
      line(PASS, "Sign-in codes will reach any recipient address.");
    }
  }
}

// ---------------------------------------------------------------------------
// Optional live send
// ---------------------------------------------------------------------------

if (testRecipient) {
  heading(`Test send to ${testRecipient}`);

  if (/@(example|test)\.(com|org|net)$/i.test(testRecipient)) {
    line(
      WARN,
      "Reserved test domains are rejected by providers with an error that reads",
    );
    console.log(
      "         like a sender problem. Use a real address you can actually read.",
    );
  }

  const subject = `${BRAND} email delivery test`;
  const text =
    "This is a test message from `pnpm check:email`.\n\n" +
    "If you are reading this, the sending address is verified and sign-in codes " +
    "will reach real users.\n";

  const url =
    provider === "brevo"
      ? "https://api.brevo.com/v3/smtp/email"
      : "https://api.resend.com/emails";

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "VirtualFamilyConnect/1.0 (+check-email)",
  };
  if (provider === "brevo") {
    headers["api-key"] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  // Same payload shape as `attempt()` in src/convex/emailDelivery.ts, so a
  // success here means the app's own send path will succeed too.
  const payload =
    provider === "brevo"
      ? {
          sender: { name: sender.name, email: sender.email },
          to: [{ email: testRecipient }],
          subject,
          htmlContent: `<p>${text.replace(/\n\n/g, "</p><p>")}</p>`,
          textContent: text,
        }
      : {
          from: `${sender.name} <${sender.email}>`,
          to: [testRecipient],
          subject,
          html: `<p>${text.replace(/\n\n/g, "</p><p>")}</p>`,
          text,
        };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await readJson(response);

    if (response.ok) {
      line(
        PASS,
        `Accepted by ${provider}${body.messageId || body.id ? ` (id ${body.messageId ?? body.id})` : ""}.`,
      );
      console.log(
        "         Check the inbox — and the spam folder, which is where a first",
      );
      console.log("         message from a new sender often lands.");
    } else {
      line(FAIL, `${provider} rejected the send: HTTP ${response.status}`);
      console.log(`         ${body.message ?? JSON.stringify(body).slice(0, 300)}`);
      reachesAnyone = false;
    }
  } catch (error) {
    line(FAIL, `Test send failed: ${error.message}`);
    reachesAnyone = false;
  }
}

// ---------------------------------------------------------------------------

heading("Verdict");

if (reachesAnyone) {
  line(PASS, "Email OTP sign-in will work for all users on this deployment.");
  process.exit(0);
}

line(FAIL, "Email OTP sign-in will NOT reliably reach users on this deployment.");
console.log(
  "\nGuest sign-in still works, and /auth warns about this state rather than\n" +
    "showing a green light — but nobody can sign in by email until it's fixed.\n",
);
process.exit(1);
