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

/**
 * Local parts a Custom Address can never take, because the Profile Domain
 * needs them: the System Addresses, the usual role names and the reply sink.
 */
export const RESERVED_LOCAL_PARTS: readonly string[] = [
  "postmaster",
  "abuse",
  "admin",
  "noreply",
  "reply",
];

const MIN_CUSTOM_LENGTH = 3;
const MAX_CUSTOM_LENGTH = 32;

export type CustomLocalPartCheck =
  | { valid: true; localPart: string }
  | { valid: false; reason: string };

/**
 * Trims and lowercases the local part of a Custom Address, then checks it
 * against the rules, giving the first rule it breaks as the reason.
 */
export function checkCustomLocalPart(raw: string): CustomLocalPartCheck {
  const localPart = raw.trim().toLowerCase();
  const refuse = (reason: string) => ({ valid: false, reason }) as const;
  if (!/^[a-z0-9.-]*$/.test(localPart)) {
    return refuse("A Custom Address can only use the letters a to z, digits, dots and hyphens.");
  }
  if (localPart.length < MIN_CUSTOM_LENGTH || localPart.length > MAX_CUSTOM_LENGTH) {
    return refuse(
      `A Custom Address must be ${MIN_CUSTOM_LENGTH} to ${MAX_CUSTOM_LENGTH} characters long.`,
    );
  }
  if (/^[.-]|[.-]$/.test(localPart)) {
    return refuse("A Custom Address can't start or end with a dot or a hyphen.");
  }
  if (/[.-]{2}/.test(localPart)) {
    return refuse("A Custom Address can't have two dots or hyphens in a row.");
  }
  if (RESERVED_LOCAL_PARTS.includes(localPart)) {
    return refuse("That address is reserved for the Profile Domain.");
  }
  return { valid: true, localPart };
}
