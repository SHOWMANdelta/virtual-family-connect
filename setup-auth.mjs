/**
 * One-shot Convex Auth setup.
 *
 * Generates the RSA keypair that Convex Auth signs session JWTs with and pushes
 * it — plus SITE_URL — to the deployment. Safe to re-run: it will not overwrite
 * existing keys unless you pass --force (regenerating keys signs everyone out).
 *
 *   node setup-auth.mjs                 # set what's missing on the dev deployment
 *   node setup-auth.mjs --force         # rotate keys
 *   node setup-auth.mjs --site-url=...  # override the app origin
 *   node setup-auth.mjs --prod --site-url=https://your-app.vercel.app
 *   node setup-auth.mjs --deployment <name>
 *
 * Replaces the old set-convex-jwt-env.sh, which called a `jwt-keygen` binary
 * that was never installed.
 */

import { execFileSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const siteUrlArg = args.find((a) => a.startsWith("--site-url="));

// Forwarded verbatim to every `convex env` call, so one flag targets one
// deployment. `--deployment` takes a value, so it has to be picked up as a pair.
const target = [];
if (args.includes("--prod")) target.push("--prod");
const deploymentIndex = args.indexOf("--deployment");
if (deploymentIndex !== -1 && args[deploymentIndex + 1]) {
  target.push("--deployment", args[deploymentIndex + 1]);
}

const label = target.length === 0 ? "dev" : target.join(" ");

// The localhost default is only ever right for the dev deployment. Writing it to
// a cloud deployment would point every invite link and OAuth redirect at a
// machine the recipient doesn't have — so make the origin explicit instead of
// guessing it.
if (target.length > 0 && !siteUrlArg) {
  console.error(
    `Refusing to target the ${label} deployment without --site-url.\n` +
      "The default is http://localhost:5173, which would break invite links and\n" +
      "OAuth redirects there. Pass the real origin:\n\n" +
      `  node setup-auth.mjs ${label} --site-url=https://your-app.vercel.app\n`,
  );
  process.exit(1);
}

const SITE_URL = siteUrlArg?.split("=")[1] ?? "http://localhost:5173";

// Resolve the Convex CLI's JS entry point and run it with the current node
// binary. Spawning `npx.cmd` fails with EINVAL on Windows under Node 20+, and
// going through a shell would mean quoting a PEM full of spaces.
//
// The bin script isn't in the package's `exports` map, so resolve package.json
// (which is) and walk to the path `bin` declares.
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

function convex(commandArgs, { capture = false } = {}) {
  return execFileSync(process.execPath, [convexCli, ...commandArgs], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function existingEnvNames() {
  try {
    // `--names-only` keeps existing secrets out of this process's buffers
    // entirely; all we ever need to know is whether a name is already taken.
    return new Set(
      convex(["env", "list", "--names-only", ...target], { capture: true })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch (error) {
    console.error(
      `\nCouldn't read the ${label} deployment's environment.\n` +
        (target.length === 0
          ? "Start it in another terminal with:  npx convex dev\n"
          : "Check that the deployment exists and you're logged in.\n"),
    );
    throw error;
  }
}

function generateKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const jwk = createPublicKey(publicKey).export({ format: "jwk" });
  jwk.use = "sig";
  jwk.alg = "RS256";

  return {
    // Convex Auth expects the PEM with literal newlines collapsed to spaces.
    JWT_PRIVATE_KEY: privateKey.trimEnd().replace(/\n/g, " "),
    JWKS: JSON.stringify({ keys: [jwk] }),
  };
}

const existing = existingEnvNames();
const hasKeys = existing.has("JWT_PRIVATE_KEY") && existing.has("JWKS");

if (hasKeys && !force) {
  console.log("JWT_PRIVATE_KEY and JWKS are already set — leaving them alone.");
  console.log("Pass --force to rotate them (this signs out every user).");
} else {
  if (hasKeys) console.log("Rotating existing auth keys (--force)…");
  const { JWT_PRIVATE_KEY, JWKS } = generateKeys();
  // Target flags go before `--`: everything after it is treated as a positional
  // value, which is the point (a PEM starts with a dash) but would also swallow
  // `--prod`.
  convex(["env", "set", ...target, "JWT_PRIVATE_KEY", "--", JWT_PRIVATE_KEY]);
  convex(["env", "set", ...target, "JWKS", "--", JWKS]);
  console.log(`Auth signing keys installed on the ${label} deployment.`);
}

convex(["env", "set", ...target, "SITE_URL", "--", SITE_URL]);
console.log(`SITE_URL set to ${SITE_URL}`);

// Email delivery fails closed: with no provider key, `sendEmail` throws rather
// than logging. That's the right default — a production deploy that forgets its
// key must not quietly write working sign-in codes to its log stream while
// telling users a code was sent.
//
// But it would also break zero-secret local development, where reading the code
// out of the `convex dev` terminal is how you sign in. So enable the console
// fallback here, and only here: a loopback SITE_URL with no provider key
// configured is unambiguously a developer's machine.
const hasMailKey =
  existing.has("RESEND_API_KEY") ||
  existing.has("AUTH_RESEND_KEY") ||
  existing.has("BREVO_API_KEY");

const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(
  SITE_URL.replace(/\/+$/, ""),
);

if (!isLoopback && existing.has("EMAIL_DEV_LOG")) {
  // Not merely "the flag is redundant" — anyone who can read this deployment's
  // logs can read a live sign-in code for any address they type in, which is a
  // full account takeover with no password to crack. Loud, and never auto-fixed:
  // removing an env var on someone's production deployment isn't this script's
  // call to make.
  console.log(
    [
      "",
      "!! EMAIL_DEV_LOG is set on a deployment whose SITE_URL is not localhost.",
      "!! Sign-in codes are being written into the log stream. Anyone who can read",
      "!! those logs can sign in as any user. Remove it now:",
      `!!   npx convex env remove EMAIL_DEV_LOG ${target.join(" ")}`.trimEnd(),
      "",
    ].join("\n"),
  );
} else if (!hasMailKey && isLoopback && !existing.has("EMAIL_DEV_LOG")) {
  convex(["env", "set", ...target, "EMAIL_DEV_LOG", "--", "true"]);
  console.log(
    "EMAIL_DEV_LOG=true — sign-in codes and invite links will be printed in the\n" +
      "`npx convex dev` terminal until you configure a real email provider.",
  );
} else if (hasMailKey && existing.has("EMAIL_DEV_LOG")) {
  console.log(
    "\nNote: EMAIL_DEV_LOG is set but a provider key exists, so mail is being\n" +
      "sent for real and the flag is doing nothing. Remove it with:\n" +
      `  npx convex env remove EMAIL_DEV_LOG ${target.join(" ")}`.trimEnd(),
  );
}

console.log(
  [
    "",
    "Sign-in is ready: email OTP and guest access both work now.",
    "",
    "Optional extras:",
    "  Real email delivery. A key alone is not enough — you must also verify the",
    "  address you send *from*, or codes reach nobody. See README section 11.",
    "",
    "    Brevo (recommended: verifies a single address, so no domain needed)",
    `      npx convex env set BREVO_API_KEY xkeysib-xxxxxxxx ${target.join(" ")}`.trimEnd(),
    `      npx convex env set EMAIL_FROM "HealthConnect <you@gmail.com>" ${target.join(" ")}`.trimEnd(),
    "",
    "    Resend (better deliverability, but needs a domain you can add DNS to)",
    `      npx convex env set RESEND_API_KEY re_xxxxxxxx ${target.join(" ")}`.trimEnd(),
    `      npx convex env set EMAIL_FROM "HealthConnect <you@yourdomain.com>" ${target.join(" ")}`.trimEnd(),
    "",
    "  Then confirm it will actually reach strangers, not just you:",
    `    pnpm check:email ${target.join(" ")}`.trimEnd(),
    "",
    "  Google sign-in",
    `    npx convex env set AUTH_GOOGLE_ID <client-id> ${target.join(" ")}`.trimEnd(),
    `    npx convex env set AUTH_GOOGLE_SECRET <client-secret> ${target.join(" ")}`.trimEnd(),
    "",
  ].join("\n"),
);
