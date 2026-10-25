// The admin page: create a Profile from a Label and, optionally, a Custom
// Address, list live and Retired Profiles, copy a Profile Address, rename a
// Label and Retire a Profile, see or fix a failed push to Cloudflare, and see
// a failed Backup, all through the JSON API.

const SIGNED_OUT = "Your Cloudflare Access sign-in has expired. Reload the page to sign in again.";
const UNREACHABLE = "Couldn't reach the admin app. Check your connection and try again.";
const FAILED = "Something went wrong on the admin app. Try again in a moment.";

// A door's foot shows the date; the time is in its tooltip.
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
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
  const icon = button.querySelector("use");
  button.dataset.state = "copied";
  label.textContent = "Copied";
  icon.setAttribute("href", "#i-check");
  clearTimeout(button.copiedTimer);
  button.copiedTimer = setTimeout(() => {
    delete button.dataset.state;
    label.textContent = "Copy";
    icon.setAttribute("href", "#i-copy");
  }, 2000);
}

/** Shows an address, letting it wrap only after its `@`, with the Profile Domain set quieter. */
function setAddress(element, address) {
  const at = address.lastIndexOf("@") + 1;
  const domain = document.createElement("span");
  domain.className = "domain";
  domain.textContent = address.slice(at);
  element.replaceChildren(address.slice(0, at), document.createElement("wbr"), domain);
}

/** The numeral plate on a door: the Profile's id, padded like a box number. */
function setPlate(element, profile) {
  element.textContent = String(profile.id).padStart(3, "0");
}

function wireCopy(button, address) {
  button.setAttribute("aria-label", `Copy ${address}`);
  button.onclick = () => copyAddress(button, address);
}

function setTime(element, prefix, iso) {
  element.dateTime = iso;
  element.textContent = `${prefix} ${dateFormat.format(new Date(iso))}`;
  element.title = dateTimeFormat.format(new Date(iso));
}

function renderDoor(profile) {
  const door = $("door-template").content.firstElementChild.cloneNode(true);
  const label = door.querySelector(".door-label");
  const actions = door.querySelector(".door-actions");
  const renameButton = door.querySelector(".rename");
  const form = door.querySelector(".rename-form");
  const input = form.querySelector("input");
  const error = form.querySelector(".error");
  const inputId = `rename-${profile.id}`;
  const retireButton = door.querySelector(".retire");
  const retireForm = door.querySelector(".retire-form");
  const retireInput = retireForm.querySelector("input");
  const retireError = retireForm.querySelector(".error");
  const retireInputId = `retire-${profile.id}`;

  label.textContent = profile.label;
  setPlate(door.querySelector(".plate"), profile);
  setTime(door.querySelector(".created"), "Created", profile.createdAt);
  setAddress(door.querySelector(".address"), profile.profileAddress);
  wireCopy(door.querySelector(".copy"), profile.profileAddress);

  input.id = inputId;
  form.querySelector("label").htmlFor = inputId;
  const labelActions = (text) => {
    renameButton.setAttribute("aria-label", `Rename ${text}`);
    retireButton.setAttribute("aria-label", `Retire ${text}`);
  };
  labelActions(profile.label);

  const closeRename = () => {
    form.hidden = true;
    label.hidden = false;
    actions.hidden = false;
    showError(error, "");
    renameButton.focus();
  };

  renameButton.onclick = () => {
    input.value = label.textContent;
    form.hidden = false;
    label.hidden = true;
    actions.hidden = true;
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
      labelActions(renamed.label);
      closeRename();
    } catch (failure) {
      showError(error, failure.message);
    } finally {
      save.disabled = false;
    }
  };

  // Retire is final, so the Owner types the whole Profile Address to confirm.
  retireInput.id = retireInputId;
  retireForm.querySelector("label").htmlFor = retireInputId;
  retireForm.querySelector(".retire-warning").id = `${retireInputId}-warning`;
  retireInput.setAttribute("aria-describedby", `${retireInputId}-warning`);
  retireInput.setAttribute("aria-label", `Type ${profile.profileAddress} to confirm`);
  setAddress(retireForm.querySelector(".address"), profile.profileAddress);

  const closeRetire = () => {
    retireForm.hidden = true;
    actions.hidden = false;
    retireInput.value = "";
    retireInput.removeAttribute("aria-invalid");
    showError(retireError, "");
    retireButton.focus();
  };

  retireButton.onclick = () => {
    retireForm.hidden = false;
    actions.hidden = true;
    retireInput.focus();
  };
  retireForm.querySelector(".cancel").onclick = closeRetire;
  retireForm.onkeydown = (event) => {
    if (event.key === "Escape") closeRetire();
  };
  retireForm.onsubmit = async (event) => {
    event.preventDefault();
    const confirm = retireForm.querySelector('button[type="submit"]');
    confirm.disabled = true;
    try {
      const retired = await api(`/api/profiles/${profile.id}/retire`, {
        method: "POST",
        body: JSON.stringify({ confirmation: retireInput.value }),
      });
      showRetired(retired);
      await loadProfiles();
    } catch (failure) {
      retireInput.setAttribute("aria-invalid", "true");
      showError(retireError, failure.message);
      retireInput.focus();
    } finally {
      confirm.disabled = false;
    }
  };

  return door;
}

function renderSealedDoor(profile) {
  const door = $("retired-template").content.firstElementChild.cloneNode(true);
  door.querySelector(".door-label").textContent = profile.label;
  setPlate(door.querySelector(".plate"), profile);
  setTime(door.querySelector(".created"), "Created", profile.createdAt);
  setTime(door.querySelector(".retired-at"), "Retired", profile.retiredAt);
  setAddress(door.querySelector(".address"), profile.profileAddress);
  return door;
}

async function loadLive() {
  const list = $("profiles");
  list.setAttribute("aria-busy", "true");
  try {
    const { profiles } = await api("/api/profiles");
    // The issued door already heads the wall, so it isn't hung twice.
    const issuedId = $("issued").hidden ? null : issuedProfileId;
    list.replaceChildren(...profiles.filter(({ id }) => id !== issuedId).map(renderDoor));
    $("live-count").textContent = profiles.length ? `(${profiles.length})` : "";
    $("empty").hidden = profiles.length > 0;
    showError($("list-error"), "");
  } catch (failure) {
    showError($("list-error"), failure.message);
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

// Shown only once something is Retired, so it never crowds the create path.
async function loadRetired() {
  const section = $("retired-section");
  try {
    const { profiles } = await api("/api/profiles/retired");
    $("retired").replaceChildren(...profiles.map(renderSealedDoor));
    $("retired-count").textContent = `(${profiles.length})`;
    section.hidden = profiles.length === 0;
    showError($("retired-error"), "");
  } catch (failure) {
    section.hidden = false;
    showError($("retired-error"), failure.message);
  }
}

// Shown after a failed push until a reconcile succeeds, so the Owner doesn't
// hand out an address that isn't working yet.
async function loadAddressList() {
  try {
    const { pushFailed } = await api("/api/address-list");
    $("push-failed").hidden = !pushFailed;
    if (pushFailed) $("reconcile-status").textContent = "";
  } catch {
    // The live list shows the same failure; the banner keeps its last state.
  }
}

// Shown after a failed Backup or check until the next Backup succeeds.
async function loadBackup() {
  try {
    const { backupFailed, lastSuccessfulBackupAt } = await api("/api/backup");
    $("backup-failed").hidden = !backupFailed;
    $("backup-failed-last").textContent = lastSuccessfulBackupAt
      ? dateFormat.format(new Date(lastSuccessfulBackupAt))
      : "unknown";
  } catch {
    // The live list shows the same failure; the banner keeps its last state.
  }
}

function loadProfiles() {
  return Promise.all([loadLive(), loadRetired(), loadAddressList(), loadBackup()]);
}

async function reconcile(button, error) {
  button.disabled = true;
  showError(error, "");
  $("reconcile-status").textContent = "";
  try {
    await api("/api/address-list/reconcile", { method: "POST" });
    $("reconcile-status").textContent = "Cloudflare's address list matches your Profiles.";
    return true;
  } catch (failure) {
    showError(error, failure.message);
    return false;
  } finally {
    button.disabled = false;
    await loadAddressList();
  }
}

$("push-failed-retry").onclick = async () => {
  if (await reconcile($("push-failed-retry"), $("push-failed-error"))) $("reconcile").focus();
};

$("reconcile").onclick = () => reconcile($("reconcile"), $("push-failed-error"));

// Workers KV takes up to about a minute to pick up a new address, so the
// new door's flag stays up that long.
const FLAG_UP_MS = 60_000;
const FLAG_UP_TEXT = $("issued-flag-text").textContent;
const FLAG_DOWN_TEXT = "A minute has passed, so this address should be working now.";
let flagTimer;
let issuedProfileId = null;

function showIssued(profile) {
  const issued = $("issued");
  const door = issued.querySelector(".door-issued");
  issuedProfileId = profile.id;
  $("issued-label").textContent = profile.label;
  setPlate($("issued-plate"), profile);
  setAddress($("issued-address"), profile.profileAddress);
  wireCopy($("issued-copy"), profile.profileAddress);
  door.dataset.flag = "up";
  $("issued-flag-text").textContent = FLAG_UP_TEXT;
  clearTimeout(flagTimer);
  flagTimer = setTimeout(() => {
    door.dataset.flag = "down";
    $("issued-flag-text").textContent = FLAG_DOWN_TEXT;
  }, FLAG_UP_MS);
  // Re-showing restarts the install animation for each new door.
  issued.hidden = true;
  void issued.offsetWidth;
  issued.hidden = false;
}

function showRetired(profile) {
  const notice = $("retired-notice");
  setAddress($("retired-notice-address"), profile.profileAddress);
  // The just-issued door must not keep offering a Retired Address to copy.
  if ($("issued-address").textContent === profile.profileAddress) $("issued").hidden = true;
  notice.hidden = false;
  // Its door is about to go, so focus moves to the notice.
  notice.focus();
}

// A Custom Address is checked against the API as the Owner types, so a bad
// or already issued address shows before the form is submitted.
const CHECK_DELAY_MS = 250;
let customCheck = null;
let customTimer;

function showCustomCheck(error, profileAddress) {
  const input = $("create-custom");
  showError($("custom-error"), error);
  if (error) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
  const preview = $("custom-preview");
  preview.textContent = profileAddress ? `The Profile Address will be ${profileAddress}.` : "";
  preview.hidden = !profileAddress;
}

/** Checks the Custom Address, resolving to its error or "" if it is fine. */
function checkCustom() {
  const value = $("create-custom").value;
  if (value.trim() === "") {
    showCustomCheck("", "");
    return Promise.resolve("");
  }
  if (customCheck?.value === value) return customCheck.result;
  const result = api("/api/custom-addresses/check", {
    method: "POST",
    body: JSON.stringify({ customLocalPart: value }),
  }).then(
    ({ profileAddress }) => ({ error: "", profileAddress }),
    (failure) => ({ error: failure.message, profileAddress: "" }),
  ).then(({ error, profileAddress }) => {
    // A slower, older check must not overwrite a newer one.
    if (customCheck?.value === value) showCustomCheck(error, profileAddress);
    return error;
  });
  customCheck = { value, result };
  return result;
}

$("create-custom").oninput = () => {
  clearTimeout(customTimer);
  customTimer = setTimeout(checkCustom, CHECK_DELAY_MS);
};

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

  clearTimeout(customTimer);
  const custom = $("create-custom");
  if (await checkCustom()) {
    $("custom").open = true;
    custom.focus();
    return;
  }

  button.disabled = true;
  button.textContent = "Creating";
  try {
    const profile = await api("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ label: input.value, customLocalPart: custom.value }),
    });
    input.value = "";
    input.removeAttribute("aria-invalid");
    custom.value = "";
    customCheck = null;
    showCustomCheck("", "");
    $("custom").open = false;
    showError(error, "");
    $("retired-notice").hidden = true;
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
