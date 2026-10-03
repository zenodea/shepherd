import type { PromptOption } from "@shepherd/protocol";
import type { HostConnection } from "../connection/host-client";

/** Give the agent a moment to open its text field after the option is picked. */
const INPUT_OPEN_MS = 400;

/**
 * Answer a blocked agent: press the option's key. For an option where you
 * write the answer yourself ("Type something.", "No, and tell Claude what to
 * do"), then type the text and press Enter.
 */
export async function sendAnswer(client: HostConnection, paneId: string, option: Pick<PromptOption, "key">, text?: string): Promise<void> {
  await client.call("agent.send_keys", { target: paneId, keys: [option.key] });
  if (text === undefined) return;
  await new Promise((resolve) => setTimeout(resolve, INPUT_OPEN_MS));
  await client.call("pane.send_input", { pane_id: paneId, text, keys: ["enter"] });
}
