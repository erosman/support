// unsafeWindow implementation
const unsafeWindow = window.wrappedJSObject;

// Mapping to window object as a temporary workaround for
// https://bugzilla.mozilla.org/show_bug.cgi?id=1715249
fetch = window.fetch.bind(window);
XMLHttpRequest = window.XMLHttpRequest;

// Instantiated subclass of Xray-wrapped DOM constructor is not an instance of the subclass, but the superclass.
// https://bugzilla.mozilla.org/show_bug.cgi?id=1820521
// Bridge function, since not possible to script.export() blob or class
// Error: Blob cannot be exported to the userScript
// Error: Return value not accessible to the userScript
// option type to mimic Import Attributes Proposal
// https://github.com/tc39/proposal-import-attributes
GM.import = async (url, option = {type: 'javascript'}) => {
  url = url.trim();
  if (!url) { return; }

  // type -> url for internal modules
  const type = url.includes('://') ? option.type : url;

  switch (type) {
    // internal ES module
    case 'PSL':
      return importBridge(url)
      .then(objectUrl => import(objectUrl));

    // object URL
    case 'gif':
    case 'jpeg':
    case 'jpg':
    case 'png':
    case 'webp':
      return importBridge(url);

    // JSON object
    case 'json':
      return GM.fetch(url, {responseType: 'json'})
      .then(response => response?.json);

    // text
    case 'css':
    case 'text':
      return GM.fetch(url)
      .then(response => response?.text);

    // DocumentFragment
    case 'html':
    case 'svg':
    case 'xhtml':
    case 'xml':
      return GM.fetch(url)
      .then(response => document.createRange().createContextualFragment(response?.text));

    // CommonJS module
    case 'cjs':
      const cjs = 'export const module = {exports: {}};\n';
      return GM.fetch(url)
      .then(response => GM.createObjectURL(cjs + response?.text))
      .then(objectUrl => import(objectUrl))
      .then(obj => obj?.module?.exports);

    // ES module
    default:
      return GM.fetch(url)
      .then(response => GM.createObjectURL(response?.text))
      .then(objectUrl => import(objectUrl));
  }
};