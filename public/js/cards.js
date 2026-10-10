// Joe 10/10, every window (app.js has the shared rule, data-card / data-open; Manager Center's cards already use data-card as
// their own key, so they open through data-href here): a click anywhere on a card opens that card's screen in its default view; a line inside the card
// (a link, a button, a box) still opens its own screen or does its own job.
export function cardClicks(root) {
  (root || document).addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.target.closest('a, button, input, select, textarea, label, summary')) return;
    const card = e.target.closest('[data-href]');
    // Handled here: the shared rule in app.js (data-card="page") then leaves it alone.
    if (card && (!root || root.contains(card))) { e.preventDefault(); location.href = card.dataset.href; }
  });
}
