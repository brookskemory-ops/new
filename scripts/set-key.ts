/**
 * Write a key into .env without opening a text editor.
 *
 *   npm run set-key                     → pick from a list
 *   npm run set-key ANTHROPIC_API_KEY   → go straight to that one
 *
 * The value is typed at a prompt rather than passed as an argument, so it never
 * lands in your shell history. It is never printed back, and the confirmation
 * shows only a masked preview.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ENV_PATH = path.join(process.cwd(), ".env");
const EXAMPLE_PATH = path.join(process.cwd(), ".env.example");

const SETTINGS: Record<string, { label: string; hint: string; secret: boolean }> = {
  ANTHROPIC_API_KEY: {
    label: "Anthropic API key (AI insights)",
    hint: "Starts with sk-ant- · get one at console.anthropic.com/settings/keys",
    secret: true,
  },
  ANTHROPIC_MODEL: {
    label: "Anthropic model",
    hint: "Leave blank for claude-opus-5, or set claude-sonnet-5 to spend less",
    secret: false,
  },
  PLAID_CLIENT_ID: {
    label: "Plaid client ID",
    hint: "From the Plaid dashboard under Developers → Keys",
    secret: false,
  },
  PLAID_SECRET: {
    label: "Plaid secret",
    hint: "Must match PLAID_ENV — sandbox secret with sandbox, production with production",
    secret: true,
  },
  PLAID_ENV: {
    label: "Plaid environment",
    hint: "sandbox (fake test banks) or production (your real bank)",
    secret: false,
  },
};

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

/**
 * Read a secret without echoing it to the terminal.
 *
 * Falls back to a visible prompt when stdin is not a TTY (piped input, some
 * Windows terminals) — better to work with the value shown than to fail.
 */
function askSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) return ask(question);

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const asMutable = rl as unknown as { _writeToOutput: (text: string) => void };
    let prompted = false;

    asMutable._writeToOutput = (text: string) => {
      // Let the question itself through once, then swallow the keystrokes.
      if (!prompted) {
        process.stdout.write(text);
        if (text.includes(question)) prompted = true;
      }
    };

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/** Show enough to confirm the right value landed, not enough to leak it. */
function mask(value: string): string {
  if (value.length <= 12) return "•".repeat(value.length);
  return `${value.slice(0, 7)}${"•".repeat(12)}${value.slice(-4)}`;
}

/**
 * Replace the line for `key`, or append it. Comments and every other setting
 * are left exactly as they were.
 */
function writeSetting(key: string, value: string) {
  if (!fs.existsSync(ENV_PATH)) {
    fs.copyFileSync(
      fs.existsSync(EXAMPLE_PATH) ? EXAMPLE_PATH : "/dev/null",
      ENV_PATH,
    );
    console.log("Created .env from .env.example");
  }

  const contents = fs.readFileSync(ENV_PATH, "utf8");
  const lines = contents.split("\n");
  const pattern = new RegExp(`^\\s*${key}\\s*=`);

  const index = lines.findIndex((line) => pattern.test(line));
  if (index === -1) {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(`${key}=${value}`);
  } else {
    lines[index] = `${key}=${value}`;
  }

  fs.writeFileSync(ENV_PATH, lines.join("\n"));
}

async function main() {
  let key = process.argv[2]?.trim().toUpperCase();

  if (!key) {
    console.log("Which setting do you want to fill in?\n");
    const names = Object.keys(SETTINGS);
    names.forEach((name, index) => {
      console.log(`  ${index + 1}. ${name.padEnd(20)} ${SETTINGS[name].label}`);
    });
    const choice = await ask("\nNumber (or the name): ");
    const byIndex = names[Number(choice.trim()) - 1];
    key = (byIndex ?? choice.trim().toUpperCase()) || "";
  }

  const setting = SETTINGS[key];
  if (!setting) {
    console.error(
      `\nDon't recognise "${key}". Known settings: ${Object.keys(SETTINGS).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`\n${setting.label}`);
  console.log(`${setting.hint}\n`);

  const value = (
    setting.secret
      ? await askSecret(`${key} (typing is hidden): `)
      : await ask(`${key}: `)
  ).trim();

  if (!value) {
    console.log("\nNothing entered — .env not changed.");
    process.exit(0);
  }

  // Pasting from a docs page often drags quotes along; they'd become part of
  // the key and produce a confusing authentication failure.
  const cleaned = value.replace(/^['"]|['"]$/g, "").trim();

  if (key === "ANTHROPIC_API_KEY" && !cleaned.startsWith("sk-ant-")) {
    console.log(
      "\nWarning: Anthropic keys normally start with 'sk-ant-'. Saving it anyway — check it if the app reports an auth error.",
    );
  }

  writeSetting(key, cleaned);

  console.log(
    `\nSaved ${key}=${setting.secret ? mask(cleaned) : cleaned} to .env`,
  );
  console.log("\nRestart the app for it to take effect:");
  console.log("  Ctrl+C, then npm run dev");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
