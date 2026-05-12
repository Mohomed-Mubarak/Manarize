/* ============================================================
   ZENMARKET — PHONE INPUT UTILITY
   Enforces Sri Lankan +94 format: +94 XX XXX XXXX (9 digits after +94)
   Usage: initPhoneInput(document.getElementById('my-phone-input'))
   ============================================================ */

const PREFIX = '+94 ';

export function initPhoneInput(input) {
  if (!input) return;

  input.type        = 'tel';
  input.maxLength   = PREFIX.length + 9 + 2; // "+94 " + 9 digits + 2 spaces
  input.placeholder = '+94 XX XXX XXXX';
  input.autocomplete = 'tel';

  // Set initial value
  if (!input.value || input.value === '+94') {
    input.value = PREFIX;
  } else {
    input.value = normalise(input.value);
  }

  input.addEventListener('focus', () => {
    if (!input.value.startsWith(PREFIX)) input.value = PREFIX;
    // Move cursor to end
    setTimeout(() => {
      input.selectionStart = input.selectionEnd = input.value.length;
    }, 0);
  });

  input.addEventListener('keydown', e => {
    const pos = input.selectionStart;
    // Prevent deleting the prefix
    if ((e.key === 'Backspace' || e.key === 'Delete') && pos <= PREFIX.length) {
      e.preventDefault();
    }
  });

  input.addEventListener('input', () => {
    const raw    = input.value;
    // Always keep the prefix
    if (!raw.startsWith(PREFIX)) {
      input.value = PREFIX;
      return;
    }
    // Strip non-digits from the part after prefix, then format
    const digits = raw.slice(PREFIX.length).replace(/\D/g, '').slice(0, 9);
    input.value  = PREFIX + formatDigits(digits);
  });

  input.addEventListener('blur', () => {
    const digits = getDigits(input.value);
    if (digits.length === 0) {
      input.value = '';  // allow empty (not required by utility)
    }
  });
}

/** Returns the full phone string from an initialised input, e.g. "+94 77 123 4567" */
export function getPhoneValue(input) {
  if (!input) return '';
  const v = input.value.trim();
  if (v === PREFIX.trim() || v === '') return '';
  return v;
}

/** Validates that the input has exactly 9 digits after +94 */
export function isPhoneValid(input) {
  const digits = getDigits(input?.value || '');
  return digits.length === 9;
}

// ── Internal helpers ──────────────────────────────────────────

function getDigits(val) {
  return val.slice(PREFIX.length).replace(/\D/g, '');
}

function formatDigits(digits) {
  // Format: XX XXX XXXX  (groups of 2, 3, 4)
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0,2)} ${digits.slice(2)}`;
  return `${digits.slice(0,2)} ${digits.slice(2,5)} ${digits.slice(5)}`;
}

function normalise(val) {
  // Accept: "0771234567" / "771234567" / "+94771234567" / "+94 77 123 4567"
  let digits = val.replace(/\D/g, '');
  if (digits.startsWith('94')) digits = digits.slice(2);
  if (digits.startsWith('0'))  digits = digits.slice(1);
  digits = digits.slice(0, 9);
  if (!digits) return PREFIX;
  return PREFIX + formatDigits(digits);
}
