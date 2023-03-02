// unsafeWindow implementation
// Mapping to window object as a temporary workaround for
// https://bugzilla.mozilla.org/show_bug.cgi?id=1715249
const unsafeWindow = window.wrappedJSObject;
fetch = window.fetch.bind(window);
XMLHttpRequest = window.XMLHttpRequest;