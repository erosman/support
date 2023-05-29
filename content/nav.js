// ---------- Navigation -----------------------------------
export class Nav {

  static process(Script) {
    const pram = location.search.substring(1);
    switch (pram) {
      case 'help':
        document.getElementById('nav1').checked = true;
        break;

      case 'log':
        document.getElementById('nav5').checked = true;
        break;

      case 'newJS':
      case 'newCSS':
        document.getElementById('nav4').checked = true;
        Script.newScript(pram.substring(3).toLowerCase());
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