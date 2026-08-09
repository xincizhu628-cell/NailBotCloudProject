const USER_AUTH_SESSION_KEY = "nailStudioUserAuthSessionV1";
const USER_SESSION_KEY = "nailStudioUserSession";

const $ = (selector) => document.querySelector(selector);

let verificationId = "";

function targetType(value) {
  return String(value || "").includes("@") ? "email" : "phone";
}

function showMessage(node, message) {
  if (!node) return;
  node.textContent = message;
  node.classList.remove("hidden");
}

async function requestCode() {
  $("#create-error")?.classList.add("hidden");
  $("#create-dev-code")?.classList.add("hidden");
  const username = $("#create-username")?.value.trim();
  const target = $("#create-target")?.value.trim();
  try {
    const response = await fetch("/api/user/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        target,
        targetType: targetType(target),
        purpose: "create_account",
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Failed to request verification code.");
    verificationId = payload.verificationId;
    $("#create-code-panel")?.classList.remove("hidden");
    if (payload.delivery?.devCode) {
      showMessage($("#create-dev-code"), `Development code: ${payload.delivery.devCode}`);
    }
  } catch (error) {
    showMessage($("#create-error"), error.message || "Failed to request verification code.");
  }
}

async function createAccount(event) {
  event.preventDefault();
  $("#create-error")?.classList.add("hidden");
  let guest = null;
  try {
    guest = JSON.parse(localStorage.getItem(USER_SESSION_KEY) || "null");
  } catch {
    guest = null;
  }
  try {
    const response = await fetch("/api/user/create-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: $("#create-username")?.value.trim(),
        password: $("#create-password")?.value || "",
        verificationId,
        code: $("#create-code")?.value.trim(),
        guestUserId: guest?.userKind === "guest" ? guest.userId : "",
        guestRecoveryCode: guest?.userKind === "guest" ? guest.recoveryCode : "",
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Failed to create account.");
    localStorage.setItem(USER_AUTH_SESSION_KEY, payload.sessionId);
    localStorage.removeItem(USER_SESSION_KEY);
    localStorage.removeItem("nailStudioGuestContinueV1");
    window.location.href = "index.html";
  } catch (error) {
    showMessage($("#create-error"), error.message || "Failed to create account.");
  }
}

$("#create-request-code")?.addEventListener("click", requestCode);
$("#create-account-form")?.addEventListener("submit", createAccount);
