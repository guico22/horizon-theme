/**
 * Copies the coupon code from the announcement bar.
 * Uses the async Clipboard API when allowed and falls back to a temporary
 * textarea + execCommand('copy') (older iOS Safari, iframes without the
 * clipboard-write permission, such as the theme editor).
 */
class CouponCopy extends HTMLElement {
  /** @type {AbortController | undefined} */
  #abortController;

  /** @type {number | undefined} */
  #resetTimeout;

  connectedCallback() {
    this.#abortController = new AbortController();
    this.querySelector('button')?.addEventListener('click', this.#handleClick, {
      signal: this.#abortController.signal,
    });
  }

  disconnectedCallback() {
    this.#abortController?.abort();
    clearTimeout(this.#resetTimeout);
  }

  #handleClick = async () => {
    const code = this.dataset.code;
    if (!code) return;

    let copied = false;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch {
      copied = CouponCopy.#fallbackCopy(code);
    }

    if (copied) this.#showCopied();
  };

  /** @param {string} text */
  static #fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.append(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  #showCopied() {
    const button = this.querySelector('button');
    const label = this.querySelector('[data-coupon-copy-label]');
    const status = this.querySelector('[data-coupon-copy-status]');
    const copiedLabel = this.dataset.copiedLabel || 'Copiado!';

    if (!button || !label) return;
    if (!button.dataset.originalLabel) button.dataset.originalLabel = label.textContent ?? '';

    label.textContent = copiedLabel;
    button.dataset.copied = '';
    if (status) status.textContent = copiedLabel;

    clearTimeout(this.#resetTimeout);
    this.#resetTimeout = setTimeout(() => {
      label.textContent = button.dataset.originalLabel ?? '';
      delete button.dataset.copied;
      if (status) status.textContent = '';
    }, 2000);
  }
}

if (!customElements.get('coupon-copy')) {
  customElements.define('coupon-copy', CouponCopy);
}
