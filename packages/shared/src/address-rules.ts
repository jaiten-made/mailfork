export interface NormalisedAddress {
  address: string;
  localPart: string;
  domain: string;
}

/**
 * Trims and lowercases an address, then splits it at the last `@`.
 * Returns null if either side of the `@` is empty or there is no `@`.
 */
export function normaliseAddress(raw: string): NormalisedAddress | null {
  const address = raw.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return null;
  return {
    address,
    localPart: address.slice(0, at),
    domain: address.slice(at + 1),
  };
}

/** Returns a whole number from 0 up to, but not including, `maxExclusive`. */
export type RandomSource = (maxExclusive: number) => number;

// Short, common, inoffensive words, each a valid Custom Address part, so a
// Generated Address is easy to read out or type on a phone.
const ADJECTIVES = [
  "amber", "ample", "bold", "brave", "bright", "brisk", "calm", "candid",
  "clear", "clever", "cosy", "crisp", "curly", "daring", "dusty", "eager",
  "early", "faded", "fancy", "fluffy", "fond", "gentle", "giddy", "glad",
  "golden", "grand", "happy", "hazy", "honest", "humble", "jolly", "keen",
  "kind", "lively", "lucky", "mellow", "merry", "mighty", "misty", "modest",
  "neat", "nimble", "noble", "plucky", "polite", "proud", "quick", "quiet",
  "rapid", "rosy", "rustic", "shiny", "silent", "silver", "snowy", "sunny",
  "swift", "tidy", "tiny", "vivid", "warm", "wise", "witty", "zesty",
] as const;

const NOUNS = [
  "acorn", "badger", "beacon", "birch", "bison", "brook", "cactus", "canyon",
  "cedar", "comet", "coral", "crane", "daisy", "dolphin", "eagle", "ember",
  "falcon", "fern", "finch", "fox", "gecko", "glacier", "harbor", "hazel",
  "heron", "island", "jaguar", "kettle", "koala", "lagoon", "lantern", "lemur",
  "lily", "lynx", "maple", "marble", "meadow", "meteor", "otter", "owl",
  "panda", "pebble", "pepper", "pine", "planet", "puffin", "quartz", "raven",
  "reef", "river", "robin", "saddle", "salmon", "sparrow", "spruce", "summit",
  "thistle", "tiger", "tulip", "valley", "walrus", "willow", "wombat", "zebra",
] as const;

function pick<T>(choices: readonly T[], random: RandomSource): T {
  const choice = choices[random(choices.length)];
  if (choice === undefined) throw new RangeError("Random source out of range");
  return choice;
}

const NUMBERS = Array.from({ length: 100 }, (_, n) => String(n).padStart(2, "0"));

/**
 * Makes the local part of a Generated Address: adjective.noun.NN, such as
 * `quiet.otter.42`. It is random and unrelated to the Owner or the Label.
 */
export function generateLocalPart(random: RandomSource): string {
  return [ADJECTIVES, NOUNS, NUMBERS].map((choices) => pick(choices, random)).join(".");
}
