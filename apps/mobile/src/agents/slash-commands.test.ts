import { describe, expect, it } from "vitest";
import type { SlashCommand } from "@shepherd/protocol";
import { commandIn, matchCommands } from "./slash-commands";

const commands: SlashCommand[] = [
  { name: "/clear", description: "" },
  { name: "/compact", description: "" },
  { name: "/context", description: "", opens: "terminal" },
  { name: "/model", description: "", opens: "model" },
  { name: "/effort", description: "", hint: "low | high" },
  { name: "/skill:grill-me", description: "" },
  { name: "/prompts:explain", description: "" },
];

describe("matchCommands", () => {
  it("lists names starting with what's typed first, then names containing it", () => {
    expect(matchCommands(commands, "/").map((c) => c.name)).toEqual(commands.map((c) => c.name));
    expect(matchCommands(commands, "/co").map((c) => c.name)).toEqual(["/compact", "/context"]);
    expect(matchCommands(commands, "/ex").map((c) => c.name)).toEqual(["/prompts:explain", "/context"]);
  });

  it("finds pi skills and Codex prompts by their short name", () => {
    expect(matchCommands(commands, "/grill").map((c) => c.name)).toEqual(["/skill:grill-me"]);
    expect(matchCommands(commands, "/SKILL:g").map((c) => c.name)).toEqual(["/skill:grill-me"]);
  });
});

describe("commandIn", () => {
  it("is the command a message starts with, with or without arguments", () => {
    expect(commandIn(commands, "/context")).toMatchObject({ opens: "terminal" });
    expect(commandIn(commands, "/effort low")).toMatchObject({ name: "/effort" });
    expect(commandIn(commands, "/contexts")).toBeNull();
    expect(commandIn(commands, "please /compact")).toBeNull();
  });
});
