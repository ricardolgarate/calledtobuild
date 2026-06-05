const form = document.getElementById("upload-form");
const input = document.getElementById("logo-input");
const dropzone = document.getElementById("dropzone");
const preview = document.getElementById("preview");
const previewImage = document.getElementById("preview-image");
const uploadButton = document.getElementById("upload-button");
const status = document.getElementById("upload-status");

let selectedFile = null;

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `upload-status${type ? ` upload-status--${type}` : ""}`;
}

function showPreview(file) {
  selectedFile = file;
  previewImage.src = URL.createObjectURL(file);
  preview.hidden = false;
  uploadButton.disabled = false;
  setStatus("");
}

function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("Please choose an image file.", "error");
    return;
  }

  showPreview(file);
}

input.addEventListener("change", () => {
  const file = input.files?.[0];
  if (file) {
    handleFile(file);
  }
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer.files?.[0];
  if (file) {
    handleFile(file);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!selectedFile) {
    setStatus("Choose a logo first.", "error");
    return;
  }

  uploadButton.disabled = true;
  setStatus("Uploading...");

  const body = new FormData();
  body.append("logo", selectedFile);

  try {
    const response = await fetch("/api/upload-favicon", {
      method: "POST",
      body,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Upload failed.");
    }

    const cacheBust = `?v=${Date.now()}`;
    const faviconPath = `${result.path}${cacheBust}`;

    document.querySelectorAll("link[rel='icon'], link[rel='apple-touch-icon']").forEach((link) => {
      link.href = faviconPath;
    });

    setStatus("Favicon updated. Refresh the landing page to see it.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    uploadButton.disabled = false;
  }
});
