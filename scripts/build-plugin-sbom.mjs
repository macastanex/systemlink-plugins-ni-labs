import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';

const execFileAsync = promisify(execFile);
const pluginArg = process.argv[2];

if (!pluginArg) {
  console.error('Usage: node scripts/build-plugin-sbom.mjs <plugin-dir>');
  process.exit(1);
}

const pluginDir = path.resolve(pluginArg);
const repoRoot = path.resolve(pluginDir, '..', '..');
const packageJson = JSON.parse(await readFile(path.join(pluginDir, 'package.json'), 'utf8'));
const config = JSON.parse(await readFile(path.join(pluginDir, 'nipkg.config.json'), 'utf8'));
const packageName = packageJson.name;

if (!packageName) {
  throw new Error(`package.json does not define a package name: ${pluginDir}`);
}

const sbomDir = path.join(pluginDir, 'sbom');
await rm(sbomDir, { recursive: true, force: true });
await mkdir(sbomDir, { recursive: true });

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sbomBaseName = (config.displayName ?? packageName)
  .replace(/[^A-Za-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '');
const formats = [
  ['cyclonedx', `${sbomBaseName}.cyclonedx.json`],
  ['spdx', `${sbomBaseName}.spdx.json`]
];

for (const [format, filename] of formats) {
  const { stdout } = await execFileAsync(
    npmCommand,
    ['sbom', '--package-lock-only', '--workspace', packageName, '--sbom-format', format, '--sbom-type', 'application'],
    { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 }
  );
  const sbom = JSON.parse(stdout);

  if (format === 'cyclonedx') {
    const pluginRef = `${packageName}@${packageJson.version}`;
    const pluginComponent = sbom.components?.find((component) => component['bom-ref'] === pluginRef);
    if (!pluginComponent) {
      throw new Error(`CycloneDX output does not contain the plugin component: ${pluginRef}`);
    }
    const rootRef = sbom.metadata.component?.['bom-ref'];
    sbom.components = sbom.components.filter((component) => component['bom-ref'] !== pluginRef);
    sbom.dependencies = sbom.dependencies?.filter((dependency) => dependency.ref !== rootRef);
    sbom.metadata.component = { ...pluginComponent, type: 'application' };
  } else {
    const pluginPackage = sbom.packages?.find((pkg) => pkg.name === packageName && pkg.versionInfo === packageJson.version);
    if (!pluginPackage) {
      throw new Error(`SPDX output does not contain the plugin package: ${packageName}@${packageJson.version}`);
    }
    const documentRelationship = sbom.relationships?.find(
      (relationship) => relationship.spdxElementId === 'SPDXRef-DOCUMENT' && relationship.relationshipType === 'DESCRIBES'
    );
    if (!documentRelationship) {
      throw new Error('SPDX output does not contain a document DESCRIBES relationship');
    }
    const rootPackageId = documentRelationship.relatedSpdxElement;
    sbom.name = `${packageName}@${packageJson.version}`;
    sbom.documentNamespace = `http://spdx.org/spdxdocs/${encodeURIComponent(packageName)}-${packageJson.version}-${randomUUID()}`;
    sbom.packages = sbom.packages.filter((pkg) => pkg.SPDXID !== rootPackageId);
    sbom.relationships = sbom.relationships.filter(
      (relationship) => relationship.spdxElementId !== rootPackageId && relationship.relatedSpdxElement !== rootPackageId
    );
    sbom.relationships.push({
      spdxElementId: 'SPDXRef-DOCUMENT',
      relatedSpdxElement: pluginPackage.SPDXID,
      relationshipType: 'DESCRIBES'
    });
  }

  await writeFile(path.join(sbomDir, filename), `${JSON.stringify(sbom, null, 2)}\n`);
  console.log(`Generated ${path.join('sbom', filename)}`);
}