import { normaliseAddress } from "@mailfork/shared";

export interface Env {
  /** Profile Address -> "live" | "retired". See docs/kv-address-list.md (repo root). */
  PROFILE_ADDRESSES: KVNamespace;
  PERSONAL_INBOX: string;
  /** Comma-separated local parts, such as "postmaster,abuse". */
  SYSTEM_ADDRESSES: string;
}

// One reason for every rejection, so senders can't tell Retired from never issued.
const REJECT_REASON = "Unknown address";

function systemLocalParts(env: Env): string[] {
  return env.SYSTEM_ADDRESSES.split(",")
    .map((localPart) => localPart.trim().toLowerCase())
    .filter((localPart) => localPart !== "");
}

export default {
  async email(message, env) {
    const recipient = normaliseAddress(message.to);
    if (!recipient) {
      message.setReject(REJECT_REASON);
      return;
    }

    if (systemLocalParts(env).includes(recipient.localPart)) {
      await message.forward(env.PERSONAL_INBOX);
      return;
    }

    const status = await env.PROFILE_ADDRESSES.get(recipient.address);
    if (status === "live") {
      await message.forward(
        env.PERSONAL_INBOX,
        new Headers({ "X-Profile-Address": recipient.address }),
      );
      return;
    }

    message.setReject(REJECT_REASON);
  },
} satisfies ExportedHandler<Env>;
