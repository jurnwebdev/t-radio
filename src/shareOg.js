/**
 * Update the Open Graph <meta> tags at runtime so that a shared
 * `?station=<slug>` link shows a station-specific card on WhatsApp
 * instead of the app-wide one. This is best-effort: the initial
 * og: tags in index.html are what crawlers actually read; this only
 * refreshes them for the user's own preview and for social clients
 * that re-render the DOM.
 *
 * Call from HomeScreen after the deep-link station is resolved.
 *
 * This lives in its own module on purpose: importing it from main.jsx
 * would make HomeScreen depend on the entry module, and the resulting
 * import cycle re-runs the createRoot() call on hot reloads.
 */
export function setShareOgMeta({ title, description, image, url }) {
  const set = (attr, name, value) => {
    let el = document.head.querySelector(`meta[${attr}="${name}"]`)
    if (!el) {
      el = document.createElement('meta')
      el.setAttribute(attr, name)
      document.head.appendChild(el)
    }
    el.setAttribute('content', value)
  }
  if (title) set('property', 'og:title', title)
  if (description) set('property', 'og:description', description)
  if (image) {
    set('property', 'og:image', image)
    set('name', 'twitter:image', image)
  }
  if (url) set('property', 'og:url', url)
}
