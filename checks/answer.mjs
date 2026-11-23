// Records the owner's answer to a question of paths.questions, with the fingerprints of the files it is about: when one
// of them changes, the question opens again by itself (state.mjs).
//   site-kit checks answer <id> "<answer>" ["a note"]       answer it
//   site-kit checks answer <id> --drop "why"                 drop it (no longer a question)
//   site-kit checks answer <id> --reopen                     open it again
//   site-kit checks answer "<tag> answer · <id>: <answer> — <note>"   the line as the report's button copied it
// The report's answer buttons copy a line «<tag> answer · <id>: <answer> — <note>» for the owner to paste into a chat;
// the agent runs this with it and commits the change with the work it leads to.
import { writeFileSync } from "node:fs";
import { siteIO } from "../lib/config.mjs";

/** «<tag> answer · <id>: <answer> — <note>» → [id, answer, note], or null when the text is not such a line */
export function parseLine(text, tag) {
  const esc = String(tag || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = String(text).trim().match(new RegExp(`^«?\\s*${esc}\\s+answer\\s*[·:-]\\s*([\\w.-]+)\\s*:\\s*([\\s\\S]*?)\\s*»?$`, "i"));
  if (!m) return null;
  const [answer, ...note] = m[2].split(/\s+—\s+/);
  return [m[1], answer.trim(), note.join(" — ").trim()];
}

/** the change to one question (pure): `hash(f)` is a file's fingerprint now */
export function applyAnswer(q, answer, note, { by, today, hash }) {
  if (answer === "--reopen") { q.status = "open"; delete q.answer; }
  else if (answer === "--drop") { q.status = "dropped"; q.dropped = { why: note || "", when: today }; }
  else { q.status = "answered"; q.answer = { choice: answer, note: note || "", when: today, by, hashes: Object.fromEntries((q.about || []).map((f) => [f, hash(f)])) }; }
  return q;
}

export async function answer(cfg, args = []) {
  const io = siteIO(cfg), FILE = cfg.paths.questions;
  let [id, ans, note] = args;
  const line = args.length === 1 && parseLine(args[0], cfg.tag);
  if (line) [id, ans, note] = line;
  if (!io.exists(FILE)) { console.error(`answer: no ${FILE}`); return 2; }
  const data = io.json(FILE);
  const q = data.questions.find((x) => x.id === id);
  if (!q) { console.error(`answer: no question «${id}». Open ones: ${data.questions.filter((x) => x.status === "open").map((x) => x.id).join(", ")}`); return 2; }
  if (!ans) { console.error('answer: give the answer: site-kit checks answer <id> "<answer>" ["note"]'); return 2; }
  const hash = (f) => io.tryGit("hash-object", io.abs(f))?.trim() || "missing";
  applyAnswer(q, ans, note, { by: cfg.owner, today: new Date().toISOString().slice(0, 10), hash });
  writeFileSync(io.abs(FILE), JSON.stringify(data, null, 2) + "\n");
  console.log(`${id}: ${q.status}${q.answer ? ` — ${q.answer.choice}` : ""}`);
  return 0;
}
