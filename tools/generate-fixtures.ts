import { ScriptCov } from "@c88/v8-coverage";
import assert from "assert";
import { SourcedScriptCov, spawnInspected } from "c88/spawn-inspected";
import fs from "fs";
import * as furi from "furi";
import { parseSys as parseNodeScriptUrl, ScriptUrl } from "node-script-url";
import sysPath from "path";
import { ModuleInfo } from "c88/filter";

async function main(): Promise<void> {
  for await (const fixture of getFixtures()) {
    await generateFixture(fixture);
  }
}

interface Fixture {
  dir: string;
  args: string[];
  output: string;
}

const CJS_BRIDGE = "\n  import {\n    executor,\n    $default\n  } from \"\";\n  export {\n    $default as default\n  }\n  if (typeof executor === \"function\") {\n    // add await to this later if top level await comes along\n    executor()\n  }";

async function* getFixtures(): AsyncIterable<Fixture> {
  const projectRoot = sysPath.resolve(__dirname, "..");
  const fixturesDir = sysPath.resolve(projectRoot, "src", "test", "fixtures");
  for (const itemName of await fs.promises.readdir(fixturesDir)) {
    const itemPath = sysPath.resolve(fixturesDir, itemName);
    if (!(await fs.promises.lstat(itemPath)).isDirectory()) {
      continue;
    }
    let fixtureConfig: Partial<Fixture> = {};
    try {
      fixtureConfig = JSON.parse((await fs.promises.readFile(sysPath.join(itemPath, "fixture.json"))).toString("UTF-8"));
    } catch (err) {
      if (err.code !== "ENOENT") {
        // tslint:disable-next-line:no-console
        console.warn(err);
      }
    }
    yield {
      dir: itemPath,
      args: [sysPath.resolve(itemPath, "main.js")],
      output: sysPath.resolve(itemPath, "v8.json"),
      ...fixtureConfig,
    };
  }
}

async function generateFixture(fixture: Fixture): Promise<void> {
  const processCovs = await spawnInspected(
    process.execPath,
    fixture.args,
    {
      cwd: fixture.dir,
      filter(info: ModuleInfo): boolean {
        return /\/fixtures\//.test(info.url);
      },
    },
  );
  assert(processCovs.length === 1);
  const processCov = processCovs[0];

  const data: FixtureData[] = normalizeData(processCov.result, fixture.dir);
  return writeJson(fixture.output, data);
}

interface FixtureData {
  sourceText: string;
  sourceType: "module" | "script";
  scriptCov: ScriptCov;
}

async function writeJson(p: string, data: any): Promise<void> {
  const json: string = JSON.stringify(data, null, 2);
  return fs.promises.writeFile(p, json, {encoding: "UTF-8"});
}

function normalizeData(
  scriptCovs: ReadonlyArray<SourcedScriptCov>,
  baseDir: string,
): FixtureData[] {
  const result: FixtureData[] = [];
  const baseDirUrl: string = furi.fromSysPath(baseDir).href;
  for (const scriptCov of scriptCovs) {
    if (scriptCov.url === "" || scriptCov.sourceText === CJS_BRIDGE) {
      continue;
    }
    const urlInfo: ScriptUrl = parseNodeScriptUrl(scriptCov.url);
    if (urlInfo.isRegularFile) {
      const url: string = tryChangeFileUrlRoot(baseDirUrl, urlInfo.url);
      result.push({
        sourceText: scriptCov.sourceText,
        sourceType: scriptCov.sourceType,
        scriptCov: {
          scriptId: scriptCov.scriptId,
          url,
          functions: scriptCov.functions,
        },
      });
    }
  }
  result.sort(compare);

  function compare(a: FixtureData, b: FixtureData): -1 | 1 {
    if (a.scriptCov.url === b.scriptCov.url) {
      throw new Error(`Unexpected equal URLs: ${a.scriptCov.url}`);
    } else {
      return a.scriptCov.url < b.scriptCov.url ? -1 : 1;
    }
  }

  return result;
}

function tryChangeFileUrlRoot(rootUrl: string, fileUrl: string): string {
  // TODO: more reliable `descendant` check
  if (!fileUrl.startsWith(rootUrl)) {
    return fileUrl;
  }
  const filePath: string = furi.toPosixPath(fileUrl);
  const rootPath: string = furi.toPosixPath(rootUrl);
  return furi.fromPosixPath(sysPath.posix.normalize(`/${sysPath.posix.relative(rootPath, filePath)}`)).href;
}

main();
