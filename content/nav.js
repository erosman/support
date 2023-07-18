// ---------- Navigation -----------------------------------
export class Nav {

  static {
    document.querySelectorAll('label[for^="nav"]').forEach(i =>
      this[i.dataset.i18n] = i.control);
  }

  static get(pram = location.search.substring(1)) {
    if (!pram) { return; }

    this[pram] ? this[pram].checked = true : this.process(pram);
  }

  static process(pram) {
    switch (pram) {
      case 'newJS':
      case 'newCSS':
        this['script'].checked = true;
        document.querySelector(`button[data-i18n^="${pram}"]`)?.click();
        break;

      default:
        if (pram.startsWith('script=')) {
          const id = '_' + decodeURI(pram.substring(7) + location.hash); // in case there is # in the name
          const li = document.getElementById(id);
          li ? li.click() : location.href = '/content/options.html'; // click or clear
        }
    }
  }
}