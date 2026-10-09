/* Zotero bootstrap lifecycle; chrome registration follows the official plugin example. */
var chromeHandle;
var pluginScope;
function install() {}
function uninstall() {}

async function startup({ rootURI }) {
  // IOUtils and PathUtils are supplied by Zotero's bootstrap sandbox.
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
  chromeHandle = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup)
    .registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
      ["content", "figureextract", rootURI + "chrome/content/"]
    ]);
  const win = Zotero.getMainWindow();
  pluginScope = {
    Zotero, Services, Components, ChromeUtils, IOUtils, PathUtils,
    AbortController: win.AbortController, TextEncoder: win.TextEncoder
  };
  Services.scriptloader.loadSubScript(rootURI + "chrome/content/plugin.js", pluginScope);
  await pluginScope.FigureExtract.startup();
}
function onMainWindowLoad({ window }) {
  pluginScope?.FigureExtract.onMainWindowLoad(window);
}
function onMainWindowUnload({ window }) {
  pluginScope?.FigureExtract.onMainWindowUnload(window);
}
async function shutdown() {
  await pluginScope?.FigureExtract.shutdown();
  pluginScope = null;
  chromeHandle?.destruct();
  chromeHandle = null;
}
