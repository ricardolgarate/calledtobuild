import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { auth } from "./firebase.js";

const form = document.querySelector("[data-auth-form]");
const message = document.querySelector("[data-auth-message]");
const mode = form?.dataset.authForm;

const authMessages = {
  "auth/email-already-in-use": "That email already has an account. Try logging in.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/weak-password": "Use a password with at least 6 characters.",
};

function setMessage(text, success = false) {
  if (!message) return;
  message.textContent = text;
  message.classList.toggle("is-success", success);
}

function redirectToDashboard() {
  window.location.href = "./crmdashboard.html";
}

onAuthStateChanged(auth, (user) => {
  if (user && (mode === "login" || mode === "signup")) {
    redirectToDashboard();
  }
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const email = String(data.get("email") || "").trim();
  const password = String(data.get("password") || "");
  const name = String(data.get("name") || "").trim();
  const submitButton = form.querySelector("button");

  submitButton.disabled = true;
  setMessage(mode === "signup" ? "Creating your account..." : "Logging in...", true);

  try {
    if (mode === "signup") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      if (name) {
        await updateProfile(credential.user, { displayName: name });
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }

    redirectToDashboard();
  } catch (error) {
    setMessage(authMessages[error.code] || error.message || "Something went wrong.");
  } finally {
    submitButton.disabled = false;
  }
});
