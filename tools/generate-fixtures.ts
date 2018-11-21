import { ScriptCov } from "@c88/v8-coverage";
import assert from "assert";
import childProcess from "child_process";
import cri from "chrome-remote-interface";
import Protocol from "devtools-protocol";
import events from "events";
import fs from "fs";
import * as furi from "furi";
import { parseSys as parseNodeScriptUrl, ScriptUrl } from "node-script-url";
import sysPath from "path";

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
  const [proc, port] = await spawnInspected(fixture.args, fixture.dir);
  let data: FixtureData[];
  try {
    data = await getCoverage(port);
    data = normalizeData(data, fixture.dir);
  } finally {
    proc.kill();
  }
  return writeJson(fixture.output, data);
}

const DEBUGGER_URI_RE = /ws:\/\/.*?:(\d+)\//;
const SPAWN_INSPECTED_TIMEOUT = 1000; // Timeout in milliseconds
const GET_COVERAGE_TIMEOUT = 1000; // Timeout in milliseconds

/**
 * Spawns a new Node process with an active inspector.
 *
 * @param args CLI arguments.
 * @return A pair, the first item is the spawned process, the second is the port number.
 */
async function spawnInspected(args: string[], cwd: string): Promise<[childProcess.ChildProcess, number]> {
  const proc: childProcess.ChildProcess = childProcess.spawn(
    process.execPath,
    [`--inspect=0`, ...args],
    {cwd, stdio: "pipe"},
  );

  const port = await new Promise<number>((resolve, reject) => {
    const timeoutId: NodeJS.Timer = setTimeout(onTimeout, SPAWN_INSPECTED_TIMEOUT);
    let stderrBuffer: Buffer = Buffer.alloc(0);
    proc.stderr.on("data", onStderrData);
    proc.once("error", onError);
    proc.once("exit", onExit);

    function onStderrData(chunk: Buffer): void {
      stderrBuffer = Buffer.concat([stderrBuffer, chunk]);
      const stderrStr = stderrBuffer.toString("UTF-8");
      const match = DEBUGGER_URI_RE.exec(stderrStr);
      if (match === null) {
        return;
      }
      const result: number = parseInt(match[1], 10);
      removeListeners();
      resolve(result);
    }

    function onError(err: Error): void {
      removeListeners();
      reject(new Error(`Unable to spawn with inspector (error}): ${args}: ${err.stack}`));
      proc.kill();
    }

    function onExit(code: number | null, signal: string | null): void {
      removeListeners();
      reject(new Error(`Unable to spawn with inspector (early exit, ${code}, ${signal}): ${args}`));
    }

    function onTimeout(): void {
      removeListeners();
      reject(new Error(`Unable to spawn with inspector (timeout): ${args}`));
      proc.kill();
    }

    function removeListeners(): void {
      proc.stderr.removeListener("data", onStderrData);
      proc.removeListener("error", onError);
      proc.removeListener("exit", onExit);
      clearTimeout(timeoutId);
    }
  });

  return [proc, port];
}

interface FixtureData {
  sourceText: string;
  sourceType: "module" | "script";
  scriptCov: ScriptCov;
}

async function getCoverage(port: number): Promise<FixtureData[]> {
  return new Promise<FixtureData[]>(async (resolve, reject) => {
    const timeoutId: NodeJS.Timer = setTimeout(onTimeout, GET_COVERAGE_TIMEOUT);
    let client: any;
    let mainExecutionContextId: Protocol.Runtime.ExecutionContextId | undefined;
    let state: string = "WaitingForMainContext"; // TODO: enum
    try {
      client = await cri({port});
      debug("Connected");

      await client.Profiler.enable();
      await client.Profiler.startPreciseCoverage({callCount: true, detailed: true});
      await client.Debugger.enable();
      debug("Enabled profiler and debugger");

      (client as any as events.EventEmitter).once("Runtime.executionContextCreated", onMainContextCreation);
      (client as any as events.EventEmitter).on("Runtime.executionContextDestroyed", onContextDestruction);

      await client.Runtime.enable();
    } catch (err) {
      removeListeners();
      reject(err);
    }

    function onMainContextCreation(ev: Protocol.Runtime.ExecutionContextCreatedEvent) {
      debug(`Main context created: ${ev.context.id}`);
      assert(state === "WaitingForMainContext");
      mainExecutionContextId = ev.context.id;
      state = "WaitingForMainContextDestruction";
    }

    async function onContextDestruction(ev: Protocol.Runtime.ExecutionContextDestroyedEvent): Promise<void> {
      assert(state === "WaitingForMainContextDestruction");
      if (ev.executionContextId !== mainExecutionContextId) {
        debug(`Context destruction: ${ev.executionContextId}`);
        return;
      }
      debug(`Main context destruction: ${ev.executionContextId}`);
      state = "WaitingForCoverage";

      try {
        debug("Querying coverage.");
        // await client.Profiler.stopPreciseCoverage();
        await client.HeapProfiler.collectGarbage();
        const {result: coverageList} = await client.Profiler.takePreciseCoverage();
        const result: FixtureData[] = [];
        debug("Querying sources.");
        for (const scriptCov of coverageList) {
          const {scriptSource: sourceText} = await client.Debugger.getScriptSource(scriptCov);
          const scriptUrl: ScriptUrl = parseNodeScriptUrl(scriptCov.url);
          result.push({
            sourceText,
            sourceType: scriptUrl.isRegularFile && scriptUrl.moduleType === "esm" ? "module" : "script",
            scriptCov,
          });
        }
        debug("Completed coverage and sources acquisition.");
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        removeListeners();
      }
    }

    function onTimeout(): void {
      removeListeners();
      reject(new Error(`Unable to get V8 coverage (timeout)`));
    }

    function removeListeners(): void {
      (client as any as events.EventEmitter).removeListener("Runtime.executionContextCreated", onMainContextCreation);
      (client as any as events.EventEmitter).removeListener("Runtime.executionContextDestroyed", onContextDestruction);
      clearTimeout(timeoutId);
      (client as any).close();
    }
  });
}

async function writeJson(p: string, data: any): Promise<void> {
  const json: string = JSON.stringify(data, null, 2);
  return fs.promises.writeFile(p, json, {encoding: "UTF-8"});
}

function normalizeData(
  fixtures: ReadonlyArray<FixtureData>,
  baseDir: string,
): FixtureData[] {
  const result: FixtureData[] = [];
  const baseDirUrl: string = furi.fromSysPath(baseDir).href;
  for (const fixture of fixtures) {
    const scriptCov: ScriptCov = fixture.scriptCov;
    if (scriptCov.url === "" || fixture.sourceText === CJS_BRIDGE) {
      continue;
    }
    const urlInfo: ScriptUrl = parseNodeScriptUrl(scriptCov.url);
    if (urlInfo.isRegularFile) {
      const normalizedUrl: string = tryChangeFileUrlRoot(baseDirUrl, urlInfo.url);
      const url = urlInfo.moduleType === "cjs" ? furi.toPosixPath(normalizedUrl) : normalizedUrl;
      result.push({...fixture, scriptCov: {...scriptCov, url}});
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

function debug(...args: any[]): void {
  // tslint:disable-next-line:no-string-literal
  if (process.env["DEBUG"] === "1") {
    // tslint:disable-next-line:no-console
    console.debug(...args);
  }
}

main();
