// Lets the app start before an Amplify backend exists. `npx ampx sandbox`
// (locally) or the Amplify pipeline (deployed) overwrite this placeholder.
import { existsSync, writeFileSync } from "node:fs";

const file = new URL("../amplify_outputs.json", import.meta.url);
if (!existsSync(file)) {
  writeFileSync(file, "{}\n");
  console.log("amplify_outputs.json not found: wrote a placeholder, so accounts are off and portfolios save in the browser.");
}
