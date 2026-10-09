/** Validate the install-time requirements enforced by Zotero's ExtensionData. */
export function validatePackage(files) {
  for (const name of ['manifest.json', 'bootstrap.js', 'chrome/content/plugin.js', 'chrome/content/ui.js']) {
    if (!files[name]?.length) throw new Error(`安装包缺少文件：${name}`);
  }
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  if (manifest.manifest_version !== 2 || !manifest.name || !manifest.version) {
    throw new Error('插件清单缺少有效的名称、版本或 manifest_version');
  }
  const application = manifest.applications?.zotero;
  // Zotero requires update_url even when no online update service is provided.
  for (const key of ['id', 'update_url', 'strict_min_version', 'strict_max_version']) {
    if (typeof application?.[key] !== 'string' || !application[key].trim()) {
      throw new Error(`applications.zotero.${key} not provided`);
    }
  }
  if (application.strict_min_version.includes('*')) throw new Error('最低兼容版本不能包含通配符');
  // XPIDatabase.isUsableAddon rejects non-HTTPS update URLs even if the
  // manifest parser accepts them. Do not disable Zotero's security setting.
  const updateURL = new URL(application.update_url);
  if (updateURL.protocol !== 'https:') throw new Error('Zotero 要求插件更新地址使用 HTTPS');
  return manifest;
}
