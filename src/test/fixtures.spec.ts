import { ScriptCov } from "@c88/v8-coverage";
import chai from "chai";
import fs from "fs";
import path from "path";
import { istanbulize, SourceType } from "../lib";
import { IstanbulFileCoverageData } from "../lib/types";
import { FixtureOptions } from "./fixture-options";

const FIXTURES_DIR = path.posix.resolve(__dirname, "fixtures");
const DATA_FILE_NAME = "v8.json";

describe("Fixtures", () => {
  for (const fixture of getFixtures()) {
    (fixture.skip ? describe.skip : describe)(fixture.name, testFixture);

    function testFixture() {
      if (process.env.SNAPSHOT === "1") {
        const snapShotData: Record<string, IstanbulFileCoverageData> = Object.create(null);
        for (const item of fixture.data) {
          it(`Generates a snapshot for: ${item.scriptCov.url}`, async () => {
            const istanbulCoverage: IstanbulFileCoverageData = istanbulize(item);
            snapShotData[item.scriptCov.url] = istanbulCoverage;
            // TODO: Only set for last test.
            await setSnapshot(fixture.name, snapShotData);
          });
        }
      } else {
        for (const item of fixture.data) {
          it(`Matches the snapshot for: ${item.scriptCov.url}`, async () => {
            const expected: IstanbulFileCoverageData = await getSnapshot(fixture.name, item.scriptCov.url);
            const actual: IstanbulFileCoverageData = istanbulize(item);
            chai.assert.deepEqual(actual, expected);
          });
        }
      }
    }
  }
});

interface Fixture {
  name: string;
  dir: string;
  data: FixtureData[];
  skip: boolean;
}

interface FixtureData {
  sourceText: string;
  sourceType: SourceType;
  scriptCov: ScriptCov;
}

function* getFixtures(): Iterable<Fixture> {
  for (const item of fs.readdirSync(FIXTURES_DIR)) {
    const itemPath: string = path.resolve(FIXTURES_DIR, item);
    if (!fs.lstatSync(itemPath).isDirectory()) {
      continue;
    }
    const dataFile: string = path.resolve(itemPath, DATA_FILE_NAME);
    const data = JSON.parse(fs.readFileSync(dataFile, "UTF-8"));
    let skip: boolean = true;
    try {
      const fixtureOptionsPath = path.resolve(itemPath, "fixture.json");
      const options: FixtureOptions = JSON.parse(fs.readFileSync(fixtureOptionsPath).toString("UTF-8"));
      if (options.skip !== undefined) {
        skip = options.skip;
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
    yield {name: item, dir: itemPath, data, skip};
  }
}

async function getSnapshot(fixtureName: string, url: string): Promise<IstanbulFileCoverageData> {
  const fixtureDir = path.resolve(FIXTURES_DIR, fixtureName);
  const snapshotPath: string = path.resolve(fixtureDir, "snapshot.json");
  let snapshotData: Record<string, any>;
  try {
    snapshotData = JSON.parse(fs.readFileSync(snapshotPath).toString("UTF-8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Snapshot file does not exit, use \`npm run generate:snapshots\`: ${snapshotPath}`);
    }
    throw err;
  }
  if (snapshotData[url] === undefined) {
    throw new Error(`${snapshotPath} does not have data for ${url}, try to use \`npm run generate:snapshots\``);
  }
  return snapshotData[url];
}

async function setSnapshot(fixtureName: string, data: Record<string, IstanbulFileCoverageData>): Promise<void> {
  const fixtureDir = path.resolve(FIXTURES_DIR, fixtureName);
  const snapshotPath: string = path.resolve(fixtureDir, "snapshot.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(data, null, 2), {encoding: "UTF-8"});
}
