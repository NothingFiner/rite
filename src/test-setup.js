// Mock scrollIntoView for jsdom
if (typeof window !== 'undefined') {
  Element.prototype.scrollIntoView = function () {}
}
