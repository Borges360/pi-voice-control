import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("voice product context stays local, mirrored, and within privacy contracts", async () => {
  const [agents, readme, spec, architecture, ux, skill, metadata, cursorSkill, cursorMetadata] = await Promise.all([
    read("AGENTS.md"),
    read("README.md"),
    read("pi-voice-control-spec.md"),
    read("docs/ARCHITECTURE.md"),
    read("docs/EXTENSION_UX.md"),
    read(".agents/skills/pi-voice-control/SKILL.md"),
    read(".agents/skills/pi-voice-control/metadata.yaml"),
    read(".cursor/skills/pi-voice-control/SKILL.md"),
    read(".cursor/skills/pi-voice-control/metadata.yaml")
  ]);
  const managed = agents.indexOf("<!-- harness:start -->");
  const context = agents.indexOf("## Product context: Pi Voice Control");
  assert.ok(context >= 0 && managed > context, "product context must precede managed Harness block");
  assert.ok(agents.slice(context, managed).includes(".agents/skills/pi-voice-control/SKILL.md"));
  assert.equal(skill, cursorSkill);
  assert.equal(metadata, cursorMetadata);
  assert.match(metadata, /id: pi-voice-control/);
  for (const source of [readme, spec, architecture, ux]) assert.ok(source.length > 0);
  for (const expected of [
    /Audio capture requires an explicit shortcut/i,
    /separate local Whisper process/i,
    /Treat recognized text as untrusted data/i,
    /Microphone integration requires the explicit VOICE_MIC_TEST=1 gate/i,
    /not an OS sandbox/i,
    /declared Pi peer range is >=1.3.0 and <1.4.0/i,
    /No INTEIRO design-system role is selected/i
  ]) assert.match(skill, expected);
});
