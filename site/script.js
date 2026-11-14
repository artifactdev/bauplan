// Screenshot lightbox. Every preview image opens in a <dialog>; Escape and a click
// on the backdrop close it again.
const dialog = document.getElementById("lightbox");
const image = dialog?.querySelector("img");
const caption = dialog?.querySelector(".lightbox-caption");
const closeButton = dialog?.querySelector(".lightbox-close");

function openLightbox(figureImage) {
  if (!dialog || !image || !caption) return;
  const figure = figureImage.closest("figure");
  image.src = figureImage.src;
  image.alt = figureImage.alt;
  caption.textContent = figure?.querySelector("figcaption")?.textContent ?? figureImage.alt;
  dialog.showModal();
}

for (const target of document.querySelectorAll(
  ".hero-shot img, .feature-shot img, .gallery-grid img",
)) {
  target.addEventListener("click", () => openLightbox(target));
  target.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openLightbox(target);
    }
  });
  target.tabIndex = 0;
  target.setAttribute("role", "button");
}

closeButton?.addEventListener("click", () => dialog.close());

dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
