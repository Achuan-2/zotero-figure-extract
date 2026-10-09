export function validatePackage(files: Record<string, Uint8Array>): {
  manifest_version: number;
  version: string;
  applications: { zotero: Record<string, string> };
};
