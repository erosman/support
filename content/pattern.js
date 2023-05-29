import {App} from './app.js';
import {Meta} from './meta.js';

// ---------- Match Pattern Tester -------------------------
export class Pattern {

  // used for globalScriptExcludeMatches in options
  static validate(node) {
    node.classList.remove('invalid');
    node.value = node.value.trim();
    if (!node.value) { return true; }                       // empty

    // sort to make it easy to compare changes in processPrefUpdate
    const array = node.value.split(/\s+/).sort();
    node.value = array.join('\n');

    // use for loop to be able to break early
    for (const item of array) {
      const error = this.hasError(item);
      if (error) {
        node.classList.add('invalid');
        App.notify(`${browser.i18n.getMessage(node.id)}\n${item}\n${error}`);
        return false;                                       // end execution
      }
    }
    return true;
  }

  static hasError(p) {
    if (Meta.validPattern(p)) { return false; }

    if (!p.includes('://')) { return 'Invalid Pattern'; }
    p = p.toLowerCase();
    const [scheme, host, path] = p.split(/:\/{2,3}|\/+/);
    const file = scheme === 'file';

    // --- common pattern errors
    switch (true) {
      case !['http', 'https', 'file', '*'].includes(scheme):
        return scheme.includes('*') ? '"*" in scheme must be the only character' : 'Unsupported scheme';

      case file && !p.startsWith('file:///'):
        return 'file:/// must have 3 slashes';

       case !host:
        return 'Missing Host';

      case host.substring(1).includes('*'):
        return '"*" in host must be at the start';

      case host[0] === '*' && host[1] && host[1] !== '.':
        return '"*" in host must be the only character or be followed by "."';

      case !file && host.includes(':'):
        return 'Host must not include a port number';

      case !file && typeof path === 'undefined':
        return 'Missing Path';

      default:
        return 'Invalid Pattern';
    }
  }
}
