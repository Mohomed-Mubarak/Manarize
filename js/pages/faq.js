/**
 * FAQ.JS — FAQ Accordion Toggle
 * ───────────────────────────────
 * Plain-JS (no module needed) accordion behaviour for the FAQ page.
 * Clicking an .accordion-btn opens/closes its sibling .accordion-body
 * and toggles the .open class on the parent .accordion-item.
 */

document.querySelectorAll('.accordion-btn').forEach(btn=>{btn.addEventListener('click',()=>{const item=btn.closest('.accordion-item');item.classList.toggle('open');});});
