// The admin page: create a Profile from a Label, list live Profiles, copy a
// Profile Address and rename a Label, all through the JSON API.

const SIGNED_OUT = "Your Cloudflare Access sign-in has expired. Reload the page to sign in again.";
const UNREACHABLE = "Couldn't reach the admin app. Check your connection and try again.";
const FAILED = "Something went wrong on the admin app. Try again in a moment.";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const $ = (id) => document.getElementById(id);

class ApiError extends Error {}

async function api(path, init = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(UNREACHABLE);
  }
  if (response.status === 401) throw new ApiError(SIGNED_OUT);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.error ?? FAILED);
  return body;
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

async function copyAddress(button, address) {
  try {
    await navigator.clipboard.writeText(address);
  } catch {
    // No clipboard access (an old browser or a denied permission): select the
    // address so the Owner can copy it from the system menu.
    const text = button.parentElement.querySelector(".address");
    getSelection()?.selectAllChildren(text);
    return;
  }
  const label = button.querySelector(".copy-text");
  button.dataset.state = "copied";
  label.textContent = "Copied";
  clearTimeout(button.copiedTimer);
  button.copiedTimer = setTimeout(() => {
    delete button.dataset.state;
    label.textContent = "Copy";
  }, 2000);
}

/** Shows an address, letting it wrap only after its `@`. */
function setAddress(element, address) {
  const parts = address.split(/(?<=@)/);
  element.replaceChildren(
    ...parts.flatMap((part, index) => (index === 0 ? [part] : [document.createElement("wbr"), part])),
  );
}

function wireCopy(button, address) {
  button.setAttribute("aria-label", `Copy ${address}`);
  button.onclick = () => copyAddress(button, address);
}

function renderTicket(profile) {
  const ticket = $("ticket-template").content.firstElementChild.cloneNode(true);
  const label = ticket.querySelector(".ticket-label");
  const created = ticket.querySelector(".created");
  const renameButton = ticket.querySelector(".rename");
  const form = ticket.querySelector(".rename-form");
  const input = form.querySelector("input");
  const error = form.querySelector(".error");
  const inputId = `rename-${profile.id}`;

  label.textContent = profile.label;
  created.dateTime = profile.createdAt;
  created.textContent = `Created ${dateFormat.format(new Date(profile.createdAt))}`;
  setAddress(ticket.querySelector(".address"), profile.profileAddress);
  wireCopy(ticket.querySelector(".copy"), profile.profileAddress);

  input.id = inputId;
  form.querySelector("label").htmlFor = inputId;
  renameButton.setAttribute("aria-label", `Rename ${profile.label}`);

  const closeRename = () => {
    form.hidden = true;
    label.hidden = false;
    renameButton.hidden = false;
    showError(error, "");
    renameButton.focus();
  };

  renameButton.onclick = () => {
    input.value = label.textContent;
    form.hidden = false;
    label.hidden = true;
    renameButton.hidden = true;
    input.focus();
    input.select();
  };
  form.querySelector(".cancel").onclick = closeRename;
  form.onkeydown = (event) => {
    if (event.key === "Escape") closeRename();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const save = form.querySelector('button[type="submit"]');
    save.disabled = true;
    try {
      const renamed = await api(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        body: JSON.stringify({ label: input.value }),
      });
      label.textContent = renamed.label;
      renameButton.setAttribute("aria-label", `Rename ${renamed.label}`);
      closeRename();
    } catch (failure) {
      showError(error, failure.message);
    } finally {
      save.disabled = false;
    }
  };

  return ticket;
}

async function loadProfiles() {
  const list = $("profiles");
  list.setAttribute("aria-busy", "true");
  try {
    const { profiles } = await api("/api/profiles");
    list.replaceChildren(...profiles.map(renderTicket));
    $("live-count").textContent = profiles.length ? `(${profiles.length})` : "";
    $("empty").hidden = profiles.length > 0;
    showError($("list-error"), "");
  } catch (failure) {
    showError($("list-error"), failure.message);
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

function showIssued(profile) {
  const issued = $("issued");
  $("issued-label").textContent = profile.label;
  setAddress($("issued-address"), profile.profileAddress);
  wireCopy($("issued-copy"), profile.profileAddress);
  // Re-showing restarts the issue animation for each new ticket.
  issued.hidden = true;
  void issued.offsetWidth;
  issued.hidden = false;
}

$("create-form").onsubmit = async (event) => {
  event.preventDefault();
  const input = $("create-label");
  const button = event.target.querySelector("button");
  const error = $("create-error");

  if (input.value.trim() === "") {
    showError(error, "Give the Profile a Label, such as Shopping.");
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }

  button.disabled = true;
  button.textContent = "Creating";
  try {
    const profile = await api("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ label: input.value }),
    });
    input.value = "";
    input.removeAttribute("aria-invalid");
    showError(error, "");
    showIssued(profile);
    $("issued-copy").focus();
    await loadProfiles();
  } catch (failure) {
    showError(error, failure.message);
  } finally {
    button.disabled = false;
    button.textContent = "Create";
  }
};

loadProfiles();
