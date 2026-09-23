const fs = require('node:fs/promises');
const path = require('node:path');
const { NtExecutable, NtExecutableResource, Resource } = require('resedit');

module.exports = async function clearUnconfiguredPublisher(context) {
  if (context.electronPlatformName !== 'win32' || require('./package.json').author?.name) return;
  const file = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const executable = NtExecutable.from(await fs.readFile(file));
  const resources = NtExecutableResource.from(executable);
  // Electron's vendor is not the publisher of this unsigned product.
  for (const version of Resource.VersionInfo.fromEntries(resources.entries)) {
    for (const language of version.getAllLanguagesForStringValues()) {
      version.setStringValues(language, { CompanyName: '' });
    }
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  await fs.writeFile(file, Buffer.from(executable.generate()));
};
