/**
 * Keeps the "Avise-me quando chegar" form in sync with the selected variant.
 * On variant change it swaps itself with the matching element from the
 * re-rendered section HTML (same approach as product-price.js).
 */
class BackInStockForm extends HTMLElement {
  /** @type {AbortController | undefined} */
  #abortController;

  connectedCallback() {
    const section = this.closest('.shopify-section, dialog');
    if (!section) return;

    this.#abortController = new AbortController();
    section.addEventListener('shopify:product:select', this.#handleProductSelect, {
      signal: this.#abortController.signal,
    });
  }

  disconnectedCallback() {
    this.#abortController?.abort();
  }

  /** @param {Event & { promise?: Promise<{ detail?: { html?: Document } }> }} event */
  #handleProductSelect = async (event) => {
    if (!(event.target instanceof Element) || event.target.closest('product-card') || !event.promise) return;

    try {
      const { detail } = await event.promise;
      const newElement = detail?.html?.querySelector(`back-in-stock-form[data-block-id="${this.dataset.blockId}"]`);
      if (newElement) this.replaceWith(document.importNode(newElement, true));
    } catch {
      // Variant fetch failed or was superseded; keep the current state.
    }
  };
}

if (!customElements.get('back-in-stock-form')) {
  customElements.define('back-in-stock-form', BackInStockForm);
}
